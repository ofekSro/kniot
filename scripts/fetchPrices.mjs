/**
 * Nightly price fetcher — Israeli price-transparency portals.
 *
 * Downloads full price files for every branch in the configured city, from:
 *   - Shufersal's public portal (branch registry scraped from its dropdown)
 *   - The Cerberus portal (publishedprices.co.il) for the chains listed below,
 *     using the law-mandated public credentials
 *
 * Local probe (no Firestore):
 *   node scripts/fetchPrices.mjs --city חיפה --max-branches 3 \
 *     --barcodes 7290000056845,7290000041445 --out scripts/out
 *
 * In CI the same fetch produces prices.json, published to GitHub Pages
 * Node >= 20, zero dependencies.
 */
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const UA = 'Mozilla/5.0 (compatible; kniot-price-bot)'

/** Cerberus-portal chains worth having in Haifa. username -> display name. */
export const CERBERUS_CHAINS = {
  RamiLevi: 'רמי לוי',
  osherad: 'אושר עד',
  yohananof: 'יוחננוף',
  TivTaam: 'טיב טעם',
}

// ---------------------------------------------------------------- helpers

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

// ---------------------------------------------------------------- Shufersal

/** Branch registry comes from the portal page's store dropdown. */
export async function shufersalBranches(city) {
  const html = await fetchText('https://prices.shufersal.co.il/')
  const out = []
  for (const m of html.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)) {
    const id = m[1]
    const label = unescapeHtml(m[2])
    if (id !== '0' && label.includes(city)) {
      out.push({ chain: 'shufersal', chainName: 'שופרסל', id, name: label })
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
  let wantedBarcodes = (opt('barcodes', '') || '').split(',').filter(Boolean)

  // In CI the barcode list comes from the public Firestore doc, not a flag.
  const trackedUrl = opt('tracked-url', '')
  if (trackedUrl && wantedBarcodes.length === 0) {
    try {
      const doc = await (await fetch(trackedUrl)).json()
      const arr = doc?.fields?.codes?.arrayValue?.values ?? []
      wantedBarcodes = arr.map((v) => v.stringValue).filter(Boolean)
      console.log(`tracked barcodes from Firestore: ${wantedBarcodes.length}`)
    } catch (e) {
      console.log('could not read tracked barcodes:', e.message)
    }
  }

  mkdirSync(outDir, { recursive: true })
  const branches = []
  const prices = {} // barcode -> { name, byBranch: { branchKey: price } }
  const failures = []

  const collect = (branch, items) => {
    const key = `${branch.chain}-${branch.id}`
    branches.push({ ...branch, key, items: items.length })
    for (const it of items) {
      if (wantedBarcodes.length && !wantedBarcodes.includes(it.code)) continue
      prices[it.code] ??= { name: it.name, byBranch: {} }
      prices[it.code].byBranch[key] = it.price
    }
    console.log(`  ✓ ${branch.chainName} ${branch.name || branch.id}: ${items.length} items`)
  }

  if (chains.includes('shufersal')) {
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

  writeFileSync(join(outDir, 'branches.json'), JSON.stringify(branches, null, 1))

  // Compact payload the app fetches: branch registry + price-by-branch per barcode.
  const published = {
    city,
    updatedAt: new Date().toISOString(),
    branches: branches.map(({ key, chainName, name, address, items }) => ({
      key, chain: chainName, name, address: address ?? '', items,
    })),
    prices, // { barcode: { name, byBranch: { branchKey: price } } }
  }
  writeFileSync(join(outDir, 'prices.json'), JSON.stringify(published))
  console.log(`\nbranches: ${branches.length} | tracked barcodes: ${Object.keys(prices).length}`)
  if (failures.length) console.log('failures:\n  ' + failures.join('\n  '))

  if (wantedBarcodes.length) {
    console.log('\n--- comparison ---')
    const keys = branches.map((b) => b.key)
    for (const [code, p] of Object.entries(prices)) {
      const row = keys.map((k) => p.byBranch[k]?.toFixed(2) ?? '—').join('  ')
      console.log(`${code} ${p.name.slice(0, 28).padEnd(30)} ${row}`)
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
