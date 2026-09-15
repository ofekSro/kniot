/**
 * Nightly price fetcher for the basket-ranking feature.
 *
 * Two data sources, each used for what it does cleanly:
 *
 *   1. chp.co.il autocomplete → turns the couple's GENERIC item names ("חלב")
 *      into a concrete product barcode + a few candidates. This endpoint returns
 *      clean JSON. (chp's price-comparison page is NOT used: after the first
 *      request per IP it CSS-obfuscates the results — decoy chars, split spans —
 *      which corrupts even the prices, so it is unusable for automated fetching.)
 *
 *   2. The government price-transparency portals → the actual per-branch prices,
 *      as clean XML with no obfuscation. Shufersal's public portal plus the
 *      Cerberus portal (publishedprices.co.il) for the chains below, matched to
 *      the resolved barcodes.
 *
 * The ranking of a basket is basket-dependent and stays client-side (coverage
 * first, then price) — see src/lib/prices.ts. This job only produces the compact
 * price-per-branch table, keyed by the app's nameKey so the app can cross its
 * list items against it directly.
 *
 * Local probe (no Firestore):
 *   node scripts/fetchPrices.mjs --city חיפה --products "חלב,לחם אחיד,ביצים L" --out scripts/out
 *
 * In CI the product list comes from the public config/trackedProducts doc:
 *   node scripts/fetchPrices.mjs --city חיפה --tracked-url <REST url> --out public_data
 *
 * Node >= 20, zero dependencies.
 */
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const UA = 'Mozilla/5.0 (compatible; kniot-price-bot)'
const CHP = 'https://chp.co.il'

/** Cerberus-portal chains worth having in Haifa. username -> display name. */
export const CERBERUS_CHAINS = {
  RamiLevi: 'רמי לוי',
  osherad: 'אושר עד',
  yohananof: 'יוחננוף',
  TivTaam: 'טיב טעם',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- helpers

/**
 * Canonical key for a product name — MUST match nameKeyOf in
 * src/lib/categories.ts, because the app crosses its list items against
 * prices.json by this exact key.
 */
export function nameKeyOf(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\//g, '-')
    .slice(0, 200)
}

function unescapeHtml(s) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

/** Portal files arrive as gz or plain, in utf-8 or utf-16 — sniff everything. */
function decodePortalFile(buf) {
  let bytes = buf
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
  for (const enc of ['utf-8', 'utf-16le']) {
    const text = new TextDecoder(enc).decode(bytes)
    if (text.includes('<Item') || text.includes('<Store')) return text
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1].trim() : ''
}

function parseItems(xml) {
  const out = []
  for (const m of xml.matchAll(/<Item[ >]([\s\S]*?)<\/Item>/g)) {
    const b = m[1]
    const code = tag(b, 'ItemCode')
    const price = Number.parseFloat(tag(b, 'ItemPrice'))
    if (!code || !Number.isFinite(price)) continue
    out.push({
      code,
      name: tag(b, 'ItemName'),
      price,
      unitQty: tag(b, 'UnitQty'),
      qty: tag(b, 'Quantity'),
      unitPrice: Number.parseFloat(tag(b, 'UnitOfMeasurePrice')) || null,
    })
  }
  return out
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 90)}`)
  return res.text()
}

async function fetchBytes(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${url.slice(0, 90)}`)
  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------- chp search

/**
 * Resolve a generic name (or a barcode) to candidate products via chp's
 * autocomplete. `id` is "<manufacturer>_<barcode>"; we keep the trailing barcode.
 * Returns [{ name, barcode }], numeric barcodes only.
 */
export async function chpAutocomplete(term) {
  const arr = JSON.parse(
    await fetchText(`${CHP}/autocompletion/product_extended?term=${encodeURIComponent(term)}`),
  )
  if (!Array.isArray(arr)) return []
  return arr
    .map((r) => ({ name: String(r.value ?? '').trim(), barcode: String(r.id ?? '').split('_').pop() }))
    .filter((p) => p.name && /^\d{6,}$/.test(p.barcode))
}

// ---------------------------------------------------------------- Shufersal

/** Branch registry comes from the portal page's store dropdown. */
export async function shufersalBranches(city) {
  const html = await fetchText('https://prices.shufersal.co.il/')
  const out = []
  for (const m of html.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)) {
    const id = m[1]
    const label = unescapeHtml(m[2])
    if (id !== '0' && label.includes(city)) {
      // Labels look like "4 - שלי חיפה- כרמל"; drop the leading store-id prefix.
      const name = label.replace(/^\d+\s*-\s*/, '')
      out.push({ chain: 'shufersal', chainName: 'שופרסל', id, name })
    }
  }
  return out
}

export async function shufersalPriceFull(branchId) {
  const html = await fetchText(
    `https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=${branchId}&sort=Time&sortdir=DESC`,
  )
  const m = html.match(/"(https?:\/\/[^"]*blob\.core\.windows\.net[^"]*)"/)
  if (!m) throw new Error(`no PriceFull link for shufersal ${branchId}`)
  return parseItems(decodePortalFile(await fetchBytes(unescapeHtml(m[1]))))
}

// ---------------------------------------------------------------- Cerberus

class Cerberus {
  constructor(username) {
    this.username = username
    this.cookie = ''
    this.token = ''
  }

  async login() {
    const res = await fetch('https://url.publishedprices.co.il/login', {
      headers: { 'User-Agent': UA },
    })
    this.cookie = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
    const html = await res.text()
    this.token = html.match(/csrftoken" content="([^"]+)"/)?.[1] ?? ''

    const login = await fetch('https://url.publishedprices.co.il/login/user', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://url.publishedprices.co.il/login',
      },
      body: new URLSearchParams({
        username: this.username,
        password: '',
        csrftoken: this.token,
      }),
      redirect: 'manual',
    })
    const fresh = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
    if (fresh.length) this.cookie = fresh.join('; ')

    // The login rotates the session, which invalidates the pre-login CSRF
    // token — the working one lives in the post-login file page's meta tag.
    const filePage = await fetchText('https://url.publishedprices.co.il/file', {
      headers: { Cookie: this.cookie },
    })
    this.token = filePage.match(/csrftoken" content="([^"]+)"/)?.[1] ?? this.token
  }

  async list(search) {
    const res = await fetchText('https://url.publishedprices.co.il/file/json/dir', {
      method: 'POST',
      headers: {
        Cookie: this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        sSearch: search,
        iDisplayLength: '100000',
        csrftoken: this.token,
      }),
    })
    return (JSON.parse(res).aaData ?? []).map((r) => r.fname)
  }

  async download(fname) {
    return fetchBytes(`https://url.publishedprices.co.il/file/d/${fname}`, {
      headers: { Cookie: this.cookie },
    })
  }

  /** City branches from the chain's Stores file. */
  async branches(city) {
    const files = await this.list('Stores')
    const storesFile = files.find((f) => /^Stores/i.test(f))
    if (!storesFile) return []
    const xml = decodePortalFile(await this.download(storesFile))
    const out = []
    for (const m of xml.matchAll(/<Store>([\s\S]*?)<\/Store>/g)) {
      const b = m[1]
      const hay = tag(b, 'City') + tag(b, 'Address') + tag(b, 'StoreName')
      if (!hay.includes(city)) continue
      out.push({
        chain: this.username,
        chainName: CERBERUS_CHAINS[this.username] ?? this.username,
        id: (tag(b, 'StoreID') || tag(b, 'StoreId')).replace(/^0+/, ''),
        name: tag(b, 'StoreName'),
        address: tag(b, 'Address'),
      })
    }
    return out
  }

  /** Store id is the third dash-segment of Cerberus PriceFull filenames. */
  async priceFull(branchId) {
    const padded = branchId.padStart(3, '0')
    const files = await this.list('PriceFull')
    const f = files
      .filter((x) => x.split('-')[2] === padded)
      .sort()
      .pop()
    if (!f) throw new Error(`no PriceFull for ${this.username} branch ${branchId}`)
    return parseItems(decodePortalFile(await this.download(f)))
  }
}

// ---------------------------------------------------------------- main

/** Read the public config/trackedProducts doc via unauthenticated REST. */
async function readTracked(url) {
  const doc = await (await fetch(url)).json()
  const f = doc?.fields ?? {}
  const products = (f.products?.arrayValue?.values ?? [])
    .map((v) => {
      const mf = v.mapValue?.fields ?? {}
      return { k: mf.k?.stringValue ?? '', n: mf.n?.stringValue ?? '' }
    })
    .filter((p) => p.n)
  const pins = {}
  for (const [k, v] of Object.entries(f.pins?.mapValue?.fields ?? {})) {
    if (v?.stringValue) pins[k] = v.stringValue
  }
  return { products, pins }
}

/** Turn tracked product names into { barcode -> {k, n, product, candidates} }. */
async function resolveBarcodes(products, pins) {
  const wanted = new Map() // barcode -> meta
  const failures = []
  for (const p of products) {
    const k = p.k || nameKeyOf(p.n)
    try {
      const pinned = pins[k]
      const candidates = (await chpAutocomplete(pinned || p.n)).slice(0, 6)
      const barcode = pinned || candidates[0]?.barcode
      if (!barcode) {
        failures.push(`${p.n}: no matching product`)
        continue
      }
      const product =
        candidates.find((c) => c.barcode === barcode)?.name ?? candidates[0]?.name ?? p.n
      wanted.set(barcode, { k, n: p.n, product, candidates })
      await sleep(150)
    } catch (e) {
      failures.push(`${p.n}: ${e.message}`)
    }
  }
  return { wanted, failures }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`)
    return i !== -1 ? args[i + 1] : dflt
  }
  const city = opt('city', 'חיפה')
  const maxBranches = Number(opt('max-branches', '0')) || Infinity
  const outDir = opt('out', 'scripts/out')
  const chains = opt('chains', `shufersal,${Object.keys(CERBERUS_CHAINS).join(',')}`)
    .split(',')
    .filter(Boolean)

  // Product list: --products "name,name" locally, else the public Firestore doc.
  let products = (opt('products', '') || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => ({ k: nameKeyOf(n), n }))
  let pins = {}
  const trackedUrl = opt('tracked-url', '')
  if (trackedUrl && products.length === 0) {
    const tracked = await readTracked(trackedUrl)
    products = tracked.products
    pins = tracked.pins
    console.log(`tracked products from Firestore: ${products.length}`)
  }

  // Resolve names → barcodes up front, via chp autocomplete.
  const { wanted, failures: resolveFailures } = await resolveBarcodes(products, pins)
  const wantedBarcodes = new Set(wanted.keys())
  console.log(`resolved ${wantedBarcodes.size}/${products.length} products to barcodes`)

  mkdirSync(outDir, { recursive: true })
  const stores = [] // { key, chain, name, address }
  const priceByBarcode = {} // barcode -> { storeKey: price }
  const failures = [...resolveFailures]

  const collect = (branch, items) => {
    const key = `${branch.chain}-${branch.id}`
    stores.push({
      key,
      chain: branch.chainName,
      name: branch.name || branch.id,
      address: branch.address ?? '',
    })
    for (const it of items) {
      if (!wantedBarcodes.has(it.code)) continue
      priceByBarcode[it.code] ??= {}
      const prev = priceByBarcode[it.code][key]
      if (prev == null || it.price < prev) priceByBarcode[it.code][key] = it.price
    }
    console.log(`  ✓ ${branch.chainName} ${branch.name || branch.id}: ${items.length} items`)
  }

  if (chains.includes('shufersal') && wantedBarcodes.size) {
    try {
      const list = (await shufersalBranches(city)).slice(0, maxBranches)
      console.log(`shufersal: ${list.length} branches in ${city}`)
      for (const b of list) {
        try {
          collect(b, await shufersalPriceFull(b.id))
        } catch (e) {
          failures.push(`shufersal ${b.id}: ${e.message}`)
        }
      }
    } catch (e) {
      failures.push(`shufersal: ${e.message}`)
    }
  }

  for (const user of chains.filter((c) => c in CERBERUS_CHAINS)) {
    if (!wantedBarcodes.size) break
    try {
      const portal = new Cerberus(user)
      await portal.login()
      const list = (await portal.branches(city)).slice(0, maxBranches)
      console.log(`${user}: ${list.length} branches in ${city}`)
      for (const b of list) {
        try {
          collect(b, await portal.priceFull(b.id))
        } catch (e) {
          failures.push(`${user} ${b.id}: ${e.message}`)
        }
      }
    } catch (e) {
      failures.push(`${user}: ${e.message}`)
    }
  }

  // Compose the compact payload the app fetches, keyed by the app's nameKey.
  const items = []
  for (const [barcode, meta] of wanted) {
    items.push({
      k: meta.k,
      n: meta.n,
      barcode,
      product: meta.product,
      byStore: priceByBarcode[barcode] ?? {},
      candidates: meta.candidates,
    })
  }
  const payload = {
    city,
    updatedAt: new Date().toISOString(),
    stores,
    items,
  }
  writeFileSync(join(outDir, 'prices.json'), JSON.stringify(payload))
  writeFileSync(join(outDir, 'branches.json'), JSON.stringify(stores, null, 1))

  const pricedCount = items.filter((it) => Object.keys(it.byStore).length).length
  console.log(`\nbranches: ${stores.length} | priced products: ${pricedCount}/${items.length}`)
  if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))

  if (items.length && stores.length) {
    console.log('\n--- basket ranking (coverage first, then total) ---')
    const rank = stores
      .map((s) => {
        let total = 0
        let covered = 0
        for (const it of items) {
          const price = it.byStore[s.key]
          if (price != null) {
            total += price
            covered++
          }
        }
        return { s, total, covered }
      })
      .filter((r) => r.covered)
      .sort((a, b) => b.covered - a.covered || a.total - b.total)
      .slice(0, 12)
    for (const r of rank) {
      console.log(
        `${String(r.total.toFixed(2)).padStart(8)}  ${r.covered}/${items.length}  ${r.s.chain} ${r.s.name}`,
      )
    }
  }
}

// Run only when executed directly, so importing this module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('fatal:', e)
    process.exit(1)
  })
}
