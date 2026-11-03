/**
 * Nightly price fetcher for the basket-ranking feature.
 *
 * Data sources, each used for what it does cleanly:
 *
 *   1. chp.co.il autocomplete → turns the couple's GENERIC item names ("חלב")
 *      into a concrete product barcode + a few candidates. Clean JSON. (chp's
 *      price-comparison page is NOT used: it CSS-obfuscates results after the
 *      first request per IP, corrupting even the prices.)
 *
 *   2. The government price-transparency portals → the actual per-branch prices,
 *      as clean XML: Shufersal's portal, the Cerberus portal
 *      (publishedprices.co.il — one public login per chain), Carrefour's portal
 *      and Hazi Hinam's blob listing.
 *
 * Two kinds of products:
 *   - PACKAGED goods carry a national barcode, so they are resolved once (chp or a
 *     user pin) and looked up by ItemCode in every branch file.
 *   - WEIGHED goods (produce, deli) have a DIFFERENT internal code per chain, so
 *     they are matched BY NAME inside each branch file among `bIsWeighted=1`
 *     items (price per kg): exact stem match first, then "<name> <qualifier>"
 *     with harmless qualifiers ("ארוז", "תפזורת") and never with ones that change
 *     the product ("אורגני", "ציפס", "שרי"…).
 *
 * The same branch files also feed a product CATALOG (catalog.json) so the app can
 * offer concrete products while typing and pin the chosen one.
 *
 * Local probe:
 *   node scripts/fetchPrices.mjs --cities "חיפה,תל אביב" --products "חלב,עגבניה" --out scripts/out
 * In CI the products + cities + pins come from the public config/trackedProducts doc:
 *   node scripts/fetchPrices.mjs --tracked-url <REST url> --out public_data
 *
 * Node >= 20, zero dependencies.
 */
import { gunzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const UA = 'Mozilla/5.0 (compatible; kniot-price-bot)'
const CHP = 'https://chp.co.il'
const CONCURRENCY = 12
/** Branch files per chain that feed the product catalog (assortments overlap). */
const CATALOG_FILES_PER_CHAIN = 6

/** Cerberus-portal chains (public, password-less logins). username -> display name. */
export const CERBERUS_CHAINS = {
  RamiLevi: 'רמי לוי',
  osherad: 'אושר עד',
  yohananof: 'יוחננוף',
  TivTaam: 'טיב טעם',
  freshmarket: 'פרש מרקט',
  doralon: 'דור אלון',
  Keshet: 'קשת טעמים',
  SalachD: 'סופר דבאח',
  politzer: 'פוליצר',
  Stop_Market: 'סטופ מרקט',
}
/** Portals with their own site. key -> display name. */
export const OTHER_CHAINS = {
  shufersal: 'שופרסל',
  carrefour: 'קרפור',
  hazihinam: 'חצי חינם',
}
export const ALL_CHAINS = [...Object.keys(OTHER_CHAINS), ...Object.keys(CERBERUS_CHAINS)]

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
    if (/<Item|<Store/i.test(text)) return text
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** `<Tag>…</Tag>` content; tolerant of `<Tag >` (Hazi Hinam writes that). */
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}\\s*>`, 'i'))
  return m ? unescapeHtml(m[1].trim()) : ''
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

// ---------------------------------------------------------------- Hebrew name matching

const FINALS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

/** Lowercase, drop quotes/niqqud, fold final letters, punctuation → spaces. */
export function normalizeName(s) {
  return String(s)
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`״׳]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[\s,.\-/()+*:]+/g, ' ')
    .trim()
}

/**
 * Crude singular/plural folding: "עגבניה"/"עגבניות" → "עגבני", "מלפפון"/"מלפפונים"
 * → "מלפפונ". Only strips when at least 3 letters remain ("תות" stays "תות").
 */
export function stemWord(w) {
  for (const suf of ['ות', 'ים', 'ה', 'ת']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length)
  }
  return w
}

export function stemName(s) {
  return normalizeName(s).split(' ').filter(Boolean).map(stemWord).join(' ')
}

/** Qualifiers that turn produce into a different product (compared by stem prefix). */
const BLOCK_STEMS = [
  'אורגני', 'ציפס', 'מיובש', 'מסוכר', 'קפוא', 'מוקפא', 'מארז', 'סלט', 'חתוך', 'קצוץ',
  'מבושל', 'אפוי', 'קלוי', 'מטוגן', 'כבוש', 'מלוח', 'ברוטב', 'במלח', 'בחומץ', 'מרוסק',
  'פולפה', 'רסק', 'מיץ', 'מחית', 'ממרח', 'אבקת', 'בטעם', 'טעם', 'שרי', 'מיני', 'בייבי',
  'קלוף', 'מגורד', 'פרוס', 'מעושן', 'מתובל', 'תבלין', 'ליטר', 'מל', 'גרם', 'יח', 'יחיד',
  'שלוק', 'קוביות', 'רצועות', 'מבחר', 'מיקס', 'ירקות', 'פירות',
].map((w) => stemWord(normalizeName(w)))
/** Qualifiers that do not change the product ("גזר ארוז" is still carrots). */
const NEUTRAL_STEMS = new Set(
  ['במשקל', 'תפזורת', 'בתפזורת', 'ארוז', 'ארוזה', 'ארוזות', 'טרי', 'טריה', 'טריים', 'מובחר', 'ישראלי', 'מקומי']
    .map((w) => stemWord(normalizeName(w))),
)

function isBlocked(stem) {
  return BLOCK_STEMS.some((b) => stem.startsWith(b))
}

/**
 * Only the weighed (`bIsWeighted=1`) items of a price file — a few hundred per
 * branch — found by jumping to each flag instead of parsing every <Item>.
 */
function parseWeighted(xml) {
  const out = []
  let pos = 0
  for (;;) {
    const at = xml.indexOf('<bIsWeighted>1</bIsWeighted>', pos)
    if (at === -1) break
    pos = at + 20
    const start = xml.lastIndexOf('<Item', at)
    const end = xml.indexOf('</Item>', at)
    if (start === -1 || end === -1) continue
    const block = xml.slice(start, end)
    const name = tag(block, 'ItemName')
    const price = Number.parseFloat(tag(block, 'ItemPrice'))
    if (!name || !Number.isFinite(price) || price <= 0) continue
    out.push({
      code: tag(block, 'ItemCode'),
      name,
      price,
      norm: normalizeName(name),
      stem: stemName(name),
    })
  }
  return out
}

/** A product name prepared for matchWeighed. */
export function weighedQuery(name) {
  return { norm: normalizeName(name), stem: stemName(name) }
}

/**
 * Best weighed item for a product name: the same name (score 0), the same stem
 * ("עגבניות"/"עגבניה", 0.5), else the name followed only by neutral/plain
 * qualifiers (1 + extra words), never a blocked qualifier. Ties go to the
 * cheaper item. Only score 0 is "exact": stems are too loose to prove that an
 * unpinned name meant produce ("חלב" stems like "חלבה").
 */
export function matchWeighed(weighted, query) {
  const { norm, stem } = query
  if (!stem) return null
  let best = null
  for (const w of weighted) {
    let score
    if (w.norm === norm) {
      score = 0
    } else if (w.stem === stem) {
      score = 0.5
    } else if (w.stem.startsWith(stem + ' ')) {
      const extra = w.stem.slice(stem.length + 1).split(' ')
      if (extra.some(isBlocked)) continue
      score = 1 + extra.filter((x) => !NEUTRAL_STEMS.has(x)).length
    } else {
      continue
    }
    if (!best || score < best.score || (score === best.score && w.price < best.price)) {
      best = { ...w, score }
    }
  }
  return best
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

// ---------------------------------------------------------------- product catalog

/**
 * Union of every product seen in the branch files, for the app's "type → pick a
 * concrete product" suggestions. Packaged goods are keyed by barcode (national),
 * weighed goods by name stem (their codes differ per chain).
 */
class Catalog {
  constructor() {
    this.chains = [] // index → display name
    this.packaged = new Map() // code → { n, ch:Set<index> }
    this.weighed = new Map() // stem → { names: Map<name,count>, ch:Set<index> }
    this.filesPerChain = {}
  }

  chainIndex(chainName) {
    let i = this.chains.indexOf(chainName)
    if (i === -1) i = this.chains.push(chainName) - 1
    return i
  }

  /** Whether another file from this chain would add much. */
  wants(chainKey) {
    return (this.filesPerChain[chainKey] ?? 0) < CATALOG_FILES_PER_CHAIN
  }

  add(xml, chainKey, chainName) {
    this.filesPerChain[chainKey] = (this.filesPerChain[chainKey] ?? 0) + 1
    const ci = this.chainIndex(chainName)
    const re = /<ItemCode\s*>([^<]*)<\/ItemCode\s*>[\s\S]*?<ItemName\s*>([^<]*)<\/ItemName\s*>[\s\S]*?<bIsWeighted\s*>(\d)/g
    for (const m of xml.matchAll(re)) {
      const code = m[1].trim()
      const name = unescapeHtml(m[2]).replace(/\s+/g, ' ').trim()
      if (!name || name.length < 2) continue
      if (m[3] === '1') {
        const stem = stemName(name)
        if (!stem) continue
        let e = this.weighed.get(stem)
        if (!e) this.weighed.set(stem, (e = { names: new Map(), ch: new Set() }))
        e.names.set(name, (e.names.get(name) ?? 0) + 1)
        e.ch.add(ci)
      } else {
        if (!/^\d{3,}$/.test(code)) continue
        let e = this.packaged.get(code)
        if (!e) this.packaged.set(code, (e = { n: name, ch: new Set() }))
        // Chains truncate names differently; keep the most complete one.
        if (name.length > e.n.length) e.n = name
        e.ch.add(ci)
      }
    }
  }

  /**
   * Compact shape (tens of thousands of rows): `[name, chainMask, barcode?]`,
   * where chainMask has bit i set for `chains[i]` and no barcode means weighed.
   */
  toJSON() {
    const mask = (set) => [...set].reduce((m, i) => m | (1 << i), 0)
    const products = []
    for (const e of this.weighed.values()) {
      // Display the most common spelling; prefer the shortest on a tie.
      const n = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
      products.push([n, mask(e.ch)])
    }
    for (const [c, e] of this.packaged) products.push([e.n, mask(e.ch), c])
    return { updatedAt: new Date().toISOString(), chains: this.chains, products }
  }
}

// ---------------------------------------------------------------- cities

/** CBS settlement codes (שם ישוב → סמל ישוב); several chains fill <City> with the code. */
const CITY_CODES = JSON.parse(readFileSync(new URL('./cityCodes.json', import.meta.url), 'utf-8'))

function cityNorm(s) {
  return String(s).replace(/קריית/g, 'קרית').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Matcher for a city: by name (substring) or by CBS code in the <City> field. */
export function cityMatcher(city) {
  const name = cityNorm(city)
  const codes = new Set()
  for (const [k, v] of Object.entries(CITY_CODES)) {
    const kn = cityNorm(k)
    if (kn === name || kn.startsWith(name + ' ')) codes.add(String(v))
  }
  return (branch) => {
    if (branch.city && codes.has(branch.city.trim())) return true
    return cityNorm(`${branch.city} ${branch.address} ${branch.name}`).includes(name)
  }
}

/** Branches from a standard Stores XML. */
function parseStores(xml, chain, chainName) {
  const out = []
  for (const m of xml.matchAll(/<Store\s*>([\s\S]*?)<\/Store\s*>/gi)) {
    const b = m[1]
    const id = (tag(b, 'StoreID') || tag(b, 'StoreId')).replace(/^0+/, '')
    if (!id) continue
    out.push({
      chain,
      chainName,
      id,
      name: tag(b, 'StoreName'),
      address: tag(b, 'Address'),
      city: tag(b, 'City'),
    })
  }
  return out
}

/** Branch id = third dash-segment of a standard PriceFull filename. */
function fileForBranch(files, branchId) {
  const padded = branchId.padStart(3, '0')
  return files
    .filter((x) => x.split('-')[2] === padded)
    .sort()
    .pop()
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
    this.branches = []
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

  /** Log in once and cache the branch list + the PriceFull file listing. */
  async ready() {
    await this.login()
    this.priceFiles = await this.list('PriceFull')
    const files = await this.list('Stores')
    const storesFile = files.find((f) => /^Stores/i.test(f))
    const xml = storesFile ? decodePortalFile(await this.download(storesFile)) : ''
    this.branches = parseStores(xml, this.username, CERBERUS_CHAINS[this.username] ?? this.username)
  }

  branchesForCity(city) {
    return this.branches.filter(cityMatcher(city))
  }

  async priceXml(branchId) {
    const f = fileForBranch(this.priceFiles, branchId)
    if (!f) throw new Error(`no PriceFull for ${this.username} branch ${branchId}`)
    return decodePortalFile(await this.download(f))
  }
}

// ---------------------------------------------------------------- Carrefour

/** prices.carrefour.co.il embeds the file listing as JSON; files live under /<date>/. */
class Carrefour {
  constructor() {
    this.base = 'https://prices.carrefour.co.il'
    this.path = ''
    this.files = []
    this.branches = []
  }

  async ready() {
    const html = await fetchText(`${this.base}/`)
    this.path = html.match(/const path = '([^']+)'/)?.[1] ?? ''
    const files = html.match(/const files = (\[[^\n]*?\]);/)?.[1]
    this.files = files ? JSON.parse(files).map((f) => f.name) : []
    const storesFile = this.files.find((f) => /^Stores/i.test(f))
    const xml = storesFile ? decodePortalFile(await fetchBytes(`${this.base}/${this.path}/${storesFile}`)) : ''
    this.branches = parseStores(xml, 'carrefour', OTHER_CHAINS.carrefour)
  }

  branchesForCity(city) {
    return this.branches.filter(cityMatcher(city))
  }

  async priceXml(branchId) {
    const f = fileForBranch(this.files.filter((x) => /^PriceFull/i.test(x)), branchId)
    if (!f) throw new Error(`no PriceFull for carrefour branch ${branchId}`)
    return decodePortalFile(await fetchBytes(`${this.base}/${this.path}/${f}`))
  }
}

// ---------------------------------------------------------------- Hazi Hinam

/** shop.hazi-hinam.co.il/Prices: paginated listing of absolute blob links. */
class HaziHinam {
  constructor() {
    this.page = 'https://shop.hazi-hinam.co.il/Prices'
    this.files = [] // absolute urls
    this.branches = []
  }

  async ready() {
    const first = await fetchText(`${this.page}?p=1&s=&f=&t=&d=`)
    const last = Math.max(1, ...[...first.matchAll(/\?p=(\d+)/g)].map((m) => Number(m[1])))
    const pages = [first]
    await mapLimit(Array.from({ length: last - 1 }, (_, i) => i + 2), 4, async (p) => {
      pages.push(await fetchText(`${this.page}?p=${p}&s=&f=&t=&d=`))
    })
    const urls = new Set()
    for (const html of pages) {
      for (const m of html.matchAll(/https:\/\/[^"'\s]+\/PriceFull\d+-\d+-\d+-[^"'\s]+/g)) urls.add(m[0])
    }
    this.files = [...urls]
    const storesPage = await fetchText(`${this.page}?p=1&s=&f=&t=Stores&d=`)
    const storesUrl = storesPage.match(/https:\/\/[^"'\s]+\/Stores[^"'\s]+/)?.[0]
    const xml = storesUrl ? decodePortalFile(await fetchBytes(storesUrl)) : ''
    this.branches = parseStores(xml, 'hazihinam', OTHER_CHAINS.hazihinam)
  }

  branchesForCity(city) {
    return this.branches.filter(cityMatcher(city))
  }

  async priceXml(branchId) {
    const padded = branchId.padStart(3, '0')
    const f = this.files
      .filter((u) => u.slice(u.lastIndexOf('/') + 1).split('-')[2] === padded)
      .sort()
      .pop()
    if (!f) throw new Error(`no PriceFull for hazihinam branch ${branchId}`)
    return decodePortalFile(await fetchBytes(f))
  }
}

// ---------------------------------------------------------------- tracked products

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
    // Legacy pins were a bare barcode string; new ones are {kind, code?, name?}.
    if (v?.stringValue) pins[k] = { kind: 'barcode', code: v.stringValue }
    const mf = v?.mapValue?.fields
    if (mf) {
      pins[k] = {
        kind: mf.kind?.stringValue === 'weighed' ? 'weighed' : 'barcode',
        code: mf.code?.stringValue ?? '',
        name: mf.name?.stringValue ?? '',
      }
    }
  }
  const cities = (f.cities?.arrayValue?.values ?? [])
    .map((v) => v.stringValue)
    .filter(Boolean)
  return { products, pins, cities }
}

/**
 * Decide, per tracked product, how it will be priced:
 *   kind 'barcode'  — look the code up in every file (pinned, or chp's top hit)
 *   kind 'weighed'  — match by name among weighed items (pinned, or chp says
 *                     "מחיר לפי משקל", or chp knows nothing)
 *   kind 'auto'     — chp gave a packaged barcode for an unpinned name; if any
 *                     file has an EXACT weighed name match the name meant produce
 *                     ("מלפפון" → cucumbers, not pickles) and that wins.
 */
async function resolveProducts(products, pins) {
  const resolved = []
  const failures = []
  await mapLimit(products, 6, async (p) => {
    const k = p.k || nameKeyOf(p.n)
    const pin = pins[k]
    try {
      if (pin?.kind === 'weighed') {
        const name = pin.name || p.n
        resolved.push({ k, n: p.n, kind: 'weighed', name, product: name, pinned: true, candidates: [] })
        return
      }
      if (pin?.code) {
        const candidates = (await chpAutocomplete(pin.code)).slice(0, 6)
        const product = candidates.find((c) => c.barcode === pin.code)?.name ?? pin.name ?? p.n
        resolved.push({ k, n: p.n, kind: 'barcode', barcode: pin.code, product, pinned: true, candidates })
        return
      }
      const candidates = (await chpAutocomplete(p.n)).slice(0, 6)
      const top = candidates[0]
      if (!top) {
        // Nothing known about the name: only a (near-)exact weighed name can price it.
        resolved.push({ k, n: p.n, kind: 'weighed', name: p.n, product: p.n, strict: true, candidates })
        return
      }
      if (/לפי משקל/.test(top.name)) {
        const product = top.name.replace(/,?\s*מחיר לפי משקל/, '').trim()
        resolved.push({ k, n: p.n, kind: 'weighed', name: p.n, product, candidates })
        return
      }
      resolved.push({ k, n: p.n, kind: 'auto', barcode: top.barcode, name: p.n, product: top.name, candidates })
    } catch (e) {
      failures.push(`${p.n}: ${e.message}`)
    }
  })
  return { resolved, failures }
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2)
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`)
    return i !== -1 ? args[i + 1] : dflt
  }
  const maxBranches = Number(opt('max-branches', '0')) || Infinity
  const outDir = opt('out', 'scripts/out')
  const chains = opt('chains', ALL_CHAINS.join(',')).split(',').filter(Boolean)

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
    console.log(`tracked products from Firestore: ${products.length}, pins: ${Object.keys(pins).length}`)
  }
  if (cities.length === 0) cities = ['חיפה']
  cities = [...new Set(cities)]

  const { resolved, failures: resolveFailures } = await resolveProducts(products, pins)
  const wantedBarcodes = new Set(resolved.filter((r) => r.barcode).map((r) => r.barcode))
  const weighedQueries = resolved
    .filter((r) => r.kind !== 'barcode')
    .map((r) => ({ k: r.k, strict: !!r.strict, ...weighedQuery(r.name) }))
    .filter((q) => q.stem)
  console.log(
    `resolved ${resolved.length}/${products.length} products ` +
      `(barcode ${resolved.filter((r) => r.kind === 'barcode').length}, weighed ${resolved.filter((r) => r.kind === 'weighed').length}, auto ${resolved.filter((r) => r.kind === 'auto').length}); cities: ${cities.length}`,
  )

  mkdirSync(outDir, { recursive: true })
  const failures = [...resolveFailures]
  const catalog = new Catalog()
  // For 'auto' products: how many branch files priced the chp barcode vs. had
  // an EXACT weighed name match. Decided after all files, by coverage, so one
  // chain's deli "שמנת חמוצה" cannot hijack a packaged product that every store
  // sells by barcode, while "מלפפון" (weighed everywhere) beats chp's pickles.
  const barcodeHits = {}
  const exactHits = {}
  const autoByBarcode = new Map()
  for (const r of resolved) {
    if (r.kind !== 'auto') continue
    if (!autoByBarcode.has(r.barcode)) autoByBarcode.set(r.barcode, [])
    autoByBarcode.get(r.barcode).push(r.k)
  }

  // Per-city accumulators.
  const acc = {}
  for (const city of cities) acc[city] = { stores: [], priceByBarcode: {}, weighedByKey: {} }

  // Gather every branch download across all cities into one task list.
  const tasks = [] // { city, branch, run: () => Promise<xml> }

  if (chains.includes('shufersal')) {
    try {
      const opts = await shufersalOptions()
      for (const city of cities) {
        const match = cityMatcher(city)
        const mine = opts.filter((o) => match({ city: '', address: '', name: o.label }))
        for (const o of mine.slice(0, maxBranches)) {
          const branch = { chain: 'shufersal', chainName: OTHER_CHAINS.shufersal, id: o.id, name: o.name }
          tasks.push({ city, branch, run: () => shufersalPriceXml(o.id) })
        }
      }
    } catch (e) {
      failures.push(`shufersal dropdown: ${e.message}`)
    }
  }

  const portals = []
  if (chains.includes('carrefour')) portals.push(['carrefour', new Carrefour()])
  if (chains.includes('hazihinam')) portals.push(['hazihinam', new HaziHinam()])
  for (const user of chains.filter((c) => c in CERBERUS_CHAINS)) portals.push([user, new Cerberus(user)])

  await mapLimit(portals, 4, async ([key, portal]) => {
    try {
      await portal.ready() // login + listings ONCE per chain
      for (const city of cities) {
        for (const b of portal.branchesForCity(city).slice(0, maxBranches)) {
          tasks.push({ city, branch: b, run: () => portal.priceXml(b.id) })
        }
      }
    } catch (e) {
      failures.push(`${key}: ${e.message}`)
    }
  })

  console.log(`downloading ${tasks.length} branch files (concurrency ${CONCURRENCY})…`)
  let done = 0
  await mapLimit(tasks, CONCURRENCY, async (t) => {
    try {
      const xml = await t.run()
      const slice = acc[t.city]
      const key = `${t.branch.chain}-${t.branch.id}`
      slice.stores.push({
        key,
        chain: t.branch.chainName,
        name: t.branch.name || t.branch.id,
        address: t.branch.address ?? '',
      })
      for (const it of parseWanted(xml, wantedBarcodes)) {
        slice.priceByBarcode[it.code] ??= {}
        const prev = slice.priceByBarcode[it.code][key]
        if (prev == null || it.price < prev) slice.priceByBarcode[it.code][key] = it.price
        for (const k of autoByBarcode.get(it.code) ?? []) barcodeHits[k] = (barcodeHits[k] ?? 0) + 1
      }
      if (weighedQueries.length) {
        const weighted = parseWeighted(xml)
        for (const q of weighedQueries) {
          const m = matchWeighed(weighted, q)
          if (!m || (q.strict && m.score > 0.5)) continue
          slice.weighedByKey[q.k] ??= {}
          slice.weighedByKey[q.k][key] = { price: m.price, name: m.name }
          if (m.score === 0) exactHits[q.k] = (exactHits[q.k] ?? 0) + 1
        }
      }
      if (catalog.wants(t.branch.chain)) catalog.add(xml, t.branch.chain, t.branch.chainName)
    } catch (e) {
      failures.push(`${t.city} ${t.branch.chainName} ${t.branch.id}: ${e.message}`)
    }
    if (++done % 50 === 0) console.log(`  …${done}/${tasks.length}`)
  })

  const isWeighed = (r) =>
    r.kind === 'weighed' ||
    (r.kind === 'auto' && (exactHits[r.k] ?? 0) > 0 && (exactHits[r.k] ?? 0) >= 0.5 * (barcodeHits[r.k] ?? 0))

  const byCity = {}
  for (const city of cities) {
    const slice = acc[city]
    const items = resolved.map((r) => {
      const weighed = isWeighed(r)
      if (weighed) {
        const hits = slice.weighedByKey[r.k] ?? {}
        const byStore = {}
        const names = new Map()
        for (const [sk, h] of Object.entries(hits)) {
          byStore[sk] = h.price
          names.set(h.name, (names.get(h.name) ?? 0) + 1)
        }
        const product = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.product
        return {
          k: r.k,
          n: r.n,
          kind: 'weighed',
          unit: 'kg',
          barcode: '',
          product,
          pinned: r.pinned ?? false,
          byStore,
          candidates: r.candidates,
        }
      }
      return {
        k: r.k,
        n: r.n,
        kind: 'barcode',
        barcode: r.barcode,
        product: r.product,
        pinned: r.pinned ?? false,
        byStore: slice.priceByBarcode[r.barcode] ?? {},
        candidates: r.candidates,
      }
    })
    byCity[city] = { city, stores: slice.stores, items }
    const priced = items.filter((it) => Object.keys(it.byStore).length).length
    const chainsHere = new Set(slice.stores.map((s) => s.chain)).size
    console.log(`[${city}] branches: ${slice.stores.length} (${chainsHere} chains) | priced: ${priced}/${items.length}`)
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
  const cat = catalog.toJSON()
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(cat))
  console.log(
    `\nwrote ${cities.length} cities, ${tasks.length} branches; catalog: ${cat.products.length} products from ${cat.chains.length} chains`,
  )
  if (failures.length) console.log(`failures: ${failures.length} (first 8)\n  ` + failures.slice(0, 8).join('\n  '))
}

// Run only when executed directly, so importing this module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('fatal:', e)
    process.exit(1)
  })
}
