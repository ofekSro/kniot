/**
 * Nightly price fetcher for the basket-ranking feature.
 *
 * Two data sources, each used for what it does cleanly:
 *
 *   1. chp.co.il autocomplete → turns the couple's GENERIC item names ("חלב")
 *      into a concrete product barcode + a few candidates. Clean JSON. (chp's
 *      price-comparison page is NOT used: it CSS-obfuscates results after the
 *      first request per IP, corrupting even the prices.)
 *
 *   2. The government price-transparency portals → the actual per-branch prices,
 *      as clean XML. Shufersal's public portal + the Cerberus portal
 *      (publishedprices.co.il) for the chains in CERBERUS_CHAINS.
 *
 * Barcodes are national, so they are resolved ONCE; prices are fetched per city.
 * To stay fast across many cities we: fetch Shufersal's branch dropdown once,
 * log in to each Cerberus chain once (caching its file listings), then download
 * every branch's price file across all cities with bounded concurrency.
 *
 * Local probe:
 *   node scripts/fetchPrices.mjs --cities "חיפה,תל אביב" --products "חלב,קפה" --out scripts/out
 * In CI the products + cities come from the public config/trackedProducts doc:
 *   node scripts/fetchPrices.mjs --tracked-url <REST url> --out public_data
 *
 * Node >= 20, zero dependencies.
 */
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const UA = 'Mozilla/5.0 (compatible; kniot-price-bot)'
const CHP = 'https://chp.co.il'
const CONCURRENCY = 12

/** Cerberus-portal chains worth having. username -> display name. */
export const CERBERUS_CHAINS = {
  RamiLevi: 'רמי לוי',
  osherad: 'אושר עד',
  yohananof: 'יוחננוף',
  TivTaam: 'טיב טעם',
}

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

/** Run `fn` over items with at most `limit` in flight at once. */
async function mapLimit(items, limit, fn) {
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx], idx)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
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

/**
 * Pull only the wanted barcodes out of a price file. Instead of regex-scanning
 * every <Item> (tens of thousands per file), jump straight to each wanted code
 * with indexOf and read the ItemPrice in its surrounding <Item> block.
 */
function parseWanted(xml, wanted) {
  const out = []
  for (const code of wanted) {
    const at = xml.indexOf(`<ItemCode>${code}</ItemCode>`)
    if (at === -1) continue
    const start = xml.lastIndexOf('<Item', at)
    const end = xml.indexOf('</Item>', at)
    if (end === -1) continue
    const block = xml.slice(start === -1 ? at : start, end)
    const price = Number.parseFloat(tag(block, 'ItemPrice'))
    if (Number.isFinite(price)) out.push({ code, price })
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

/** Resolve a term (product name or barcode) to candidate products via chp. */
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

/** All branches from the portal's store dropdown (fetched once). */
export async function shufersalOptions() {
  const html = await fetchText('https://prices.shufersal.co.il/')
  const out = []
  for (const m of html.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)) {
    if (m[1] === '0') continue
    // Labels look like "4 - שלי חיפה- כרמל"; drop the leading store-id prefix.
    const label = unescapeHtml(m[2])
    out.push({ id: m[1], label, name: label.replace(/^\d+\s*-\s*/, '') })
  }
  return out
}

async function shufersalPriceXml(branchId) {
  const html = await fetchText(
    `https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=${branchId}&sort=Time&sortdir=DESC`,
  )
  const m = html.match(/"(https?:\/\/[^"]*blob\.core\.windows\.net[^"]*)"/)
  if (!m) throw new Error(`no PriceFull link for shufersal ${branchId}`)
  return decodePortalFile(await fetchBytes(unescapeHtml(m[1])))
}

// ---------------------------------------------------------------- Cerberus

class Cerberus {
  constructor(username) {
    this.username = username
    this.cookie = ''
    this.token = ''
    this.priceFiles = []
    this.storesXml = ''
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
      body: new URLSearchParams({ username: this.username, password: '', csrftoken: this.token }),
      redirect: 'manual',
    })
    const fresh = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
    if (fresh.length) this.cookie = fresh.join('; ')

    // The login rotates the session, invalidating the pre-login CSRF token —
    // the working one lives in the post-login file page's meta tag.
    const filePage = await fetchText('https://url.publishedprices.co.il/file', {
      headers: { Cookie: this.cookie },
    })
    this.token = filePage.match(/csrftoken" content="([^"]+)"/)?.[1] ?? this.token
  }

  async list(search) {
    const res = await fetchText('https://url.publishedprices.co.il/file/json/dir', {
      method: 'POST',
      headers: { Cookie: this.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sSearch: search, iDisplayLength: '100000', csrftoken: this.token }),
    })
    return (JSON.parse(res).aaData ?? []).map((r) => r.fname)
  }

  download(fname) {
    return fetchBytes(`https://url.publishedprices.co.il/file/d/${fname}`, {
      headers: { Cookie: this.cookie },
    })
  }

  /** Log in once and cache the Stores XML + the PriceFull file listing. */
  async ready() {
    await this.login()
    this.priceFiles = await this.list('PriceFull')
    const files = await this.list('Stores')
    const storesFile = files.find((f) => /^Stores/i.test(f))
    this.storesXml = storesFile ? decodePortalFile(await this.download(storesFile)) : ''
  }

  /** City branches from the cached Stores file. */
  branchesForCity(city) {
    const out = []
    for (const m of this.storesXml.matchAll(/<Store>([\s\S]*?)<\/Store>/g)) {
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

  /** Price XML for a branch, using the cached PriceFull listing. */
  async priceXml(branchId) {
    const padded = branchId.padStart(3, '0')
    const f = this.priceFiles
      .filter((x) => x.split('-')[2] === padded)
      .sort()
      .pop()
    if (!f) throw new Error(`no PriceFull for ${this.username} branch ${branchId}`)
    return decodePortalFile(await this.download(f))
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
  const cities = (f.cities?.arrayValue?.values ?? [])
    .map((v) => v.stringValue)
    .filter(Boolean)
  return { products, pins, cities }
}

/** Turn tracked product names into { barcode -> {k, n, product, candidates} }. */
async function resolveBarcodes(products, pins) {
  const wanted = new Map()
  const failures = []
  await mapLimit(products, 6, async (p) => {
    const k = p.k || nameKeyOf(p.n)
    try {
      const pinned = pins[k]
      const candidates = (await chpAutocomplete(pinned || p.n)).slice(0, 6)
      const barcode = pinned || candidates[0]?.barcode
      if (!barcode) {
        failures.push(`${p.n}: no matching product`)
        return
      }
      const product =
        candidates.find((c) => c.barcode === barcode)?.name ?? candidates[0]?.name ?? p.n
      wanted.set(barcode, { k, n: p.n, product, candidates })
    } catch (e) {
      failures.push(`${p.n}: ${e.message}`)
    }
  })
  return { wanted, failures }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`)
    return i !== -1 ? args[i + 1] : dflt
  }
  const maxBranches = Number(opt('max-branches', '0')) || Infinity
  const outDir = opt('out', 'scripts/out')
  const chains = opt('chains', `shufersal,${Object.keys(CERBERUS_CHAINS).join(',')}`)
    .split(',')
    .filter(Boolean)

  let products = (opt('products', '') || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => ({ k: nameKeyOf(n), n }))
  let pins = {}
  let cities = (opt('cities', '') || '').split(',').map((c) => c.trim()).filter(Boolean)
  const singleCity = opt('city', '')
  if (singleCity) cities.unshift(singleCity)

  const trackedUrl = opt('tracked-url', '')
  if (trackedUrl && products.length === 0) {
    const tracked = await readTracked(trackedUrl)
    products = tracked.products
    pins = tracked.pins
    if (cities.length === 0) cities = tracked.cities
    console.log(`tracked products from Firestore: ${products.length}`)
  }
  if (cities.length === 0) cities = ['חיפה']
  cities = [...new Set(cities)]

  const { wanted, failures: resolveFailures } = await resolveBarcodes(products, pins)
  const wantedBarcodes = new Set(wanted.keys())
  console.log(`resolved ${wantedBarcodes.size}/${products.length} products; cities: ${cities.length}`)

  mkdirSync(outDir, { recursive: true })
  const failures = [...resolveFailures]

  // Per-city accumulators.
  const acc = {}
  for (const city of cities) acc[city] = { stores: [], priceByBarcode: {} }

  // Gather every branch download across all cities into one task list.
  const tasks = [] // { city, branch, run: () => Promise<xml> }

  if (chains.includes('shufersal') && wantedBarcodes.size) {
    try {
      const opts = await shufersalOptions()
      for (const city of cities) {
        for (const o of opts.filter((x) => x.label.includes(city)).slice(0, maxBranches)) {
          const branch = { chain: 'shufersal', chainName: 'שופרסל', id: o.id, name: o.name }
          tasks.push({ city, branch, run: () => shufersalPriceXml(o.id) })
        }
      }
    } catch (e) {
      failures.push(`shufersal dropdown: ${e.message}`)
    }
  }

  for (const user of chains.filter((c) => c in CERBERUS_CHAINS)) {
    if (!wantedBarcodes.size) break
    try {
      const portal = new Cerberus(user)
      await portal.ready() // login + listings ONCE per chain
      for (const city of cities) {
        for (const b of portal.branchesForCity(city).slice(0, maxBranches)) {
          tasks.push({ city, branch: b, run: () => portal.priceXml(b.id) })
        }
      }
    } catch (e) {
      failures.push(`${user}: ${e.message}`)
    }
  }

  console.log(`downloading ${tasks.length} branch files (concurrency ${CONCURRENCY})…`)
  let done = 0
  await mapLimit(tasks, CONCURRENCY, async (t) => {
    try {
      const items = parseWanted(await t.run(), wantedBarcodes)
      const slice = acc[t.city]
      const key = `${t.branch.chain}-${t.branch.id}`
      slice.stores.push({
        key,
        chain: t.branch.chainName,
        name: t.branch.name || t.branch.id,
        address: t.branch.address ?? '',
      })
      for (const it of items) {
        slice.priceByBarcode[it.code] ??= {}
        const prev = slice.priceByBarcode[it.code][key]
        if (prev == null || it.price < prev) slice.priceByBarcode[it.code][key] = it.price
      }
    } catch (e) {
      failures.push(`${t.city} ${t.branch.chainName} ${t.branch.id}: ${e.message}`)
    }
    if (++done % 50 === 0) console.log(`  …${done}/${tasks.length}`)
  })

  const byCity = {}
  for (const city of cities) {
    const slice = acc[city]
    const items = [...wanted].map(([barcode, meta]) => ({
      k: meta.k,
      n: meta.n,
      barcode,
      product: meta.product,
      byStore: slice.priceByBarcode[barcode] ?? {},
      candidates: meta.candidates,
    }))
    byCity[city] = { city, stores: slice.stores, items }
    const priced = items.filter((it) => Object.keys(it.byStore).length).length
    console.log(`[${city}] branches: ${slice.stores.length} | priced: ${priced}/${items.length}`)
  }

  const first = byCity[cities[0]]
  const payload = {
    updatedAt: new Date().toISOString(),
    cities,
    byCity,
    // Back-compat top-level mirror of the first city (older app builds read this).
    city: first.city,
    stores: first.stores,
    items: first.items,
  }
  writeFileSync(join(outDir, 'prices.json'), JSON.stringify(payload))
  writeFileSync(
    join(outDir, 'branches.json'),
    JSON.stringify(Object.fromEntries(cities.map((c) => [c, byCity[c].stores.length])), null, 1),
  )
  console.log(`\nwrote ${cities.length} cities, ${tasks.length} branches`)
  if (failures.length) console.log(`failures: ${failures.length} (first 5)\n  ` + failures.slice(0, 5).join('\n  '))
}

// Run only when executed directly, so importing this module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('fatal:', e)
    process.exit(1)
  })
}
