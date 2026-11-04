/**
 * Nightly price fetcher for the basket-ranking feature.
 *
 * Data sources, each used for what it does cleanly:
 *
 *   1. The government price-transparency portals → the actual per-branch prices,
 *      as clean XML: Shufersal's portal, the Cerberus portal
 *      (publishedprices.co.il — one public login per chain), Carrefour's portal
 *      and Hazi Hinam's blob listing.
 *
 *   2. chp.co.il autocomplete → a fallback barcode for names no branch file knows
 *      by name. Clean JSON. (chp's price-comparison page is NOT used: it
 *      CSS-obfuscates results after the first request per IP, corrupting even the
 *      prices.)
 *
 * The couple's list holds GENERIC names ("משקה שיבולת שועל"), so a name is priced as:
 *   - WEIGHED (produce, deli): chains give these a different internal code, so they
 *     are matched by name among `bIsWeighted=1` items (price per kg).
 *   - FAMILY (packaged): every item whose name contains the generic name. All chains
 *     are compared on one pack size (the most widely stocked), and each branch's
 *     price is its cheapest item of that size; the item itself is recorded per
 *     branch so the in-store view can show what to take and its barcode.
 *   - BARCODE: an exact code pinned earlier, or chp's when the name matches nothing.
 *
 * The same branch files also feed a catalog of generic names (catalog.json) that the
 * app offers while typing.
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
    .replaceAll('&apos;', "'")
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

/**
 * Lowercase, drop quotes/niqqud, fold final letters and the double-yod spelling
 * ("עגבנייה" → "עגבניה"), punctuation → spaces.
 */
export function normalizeName(s) {
  return String(s)
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`״׳]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/יי/g, 'י')
    .replace(/[\s,.\-/()+*:]+/g, ' ')
    .trim()
}

/**
 * Words whose "suffix" is part of a different word: חלבה≠חלב, שמנת≠שמן, לבנה≠לבן,
 * ביצת (הפתעה)≠ביצה.
 */
const NO_STEM = new Set(['חלבה', 'שמנת', 'לבנה', 'ביצת'])

function foldSuffix(w) {
  if (NO_STEM.has(w)) return w
  for (const suf of ['ות', 'ימ', 'ה', 'ת']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length)
  }
  return w
}

/**
 * One size scale, however a chain words it, for any product: "ביצים 12 יח גדול L",
 * "ביצים לארג'" and "כפפות L" all say L. Without this each wording would be its own
 * choice in the app. Mirrored in src/lib/catalog.ts.
 */
const GRADE_WORDS = {
  s: ['קטן', 'קטנה', 'קטנים', 'קטנות', 'small'],
  m: ['בינוני', 'בינונית', 'בינוניים', 'בינוניות', 'מדיום', 'medium'],
  l: ['גדול', 'גדולה', 'גדולים', 'גדולות', 'לארג', 'large'],
  xl: ['ענק', 'ענקית', 'ענקיים', 'ענקיות'],
}
const GRADES = new Set(Object.keys(GRADE_WORDS))
/** Words that always name a kind of the product: a size on the scale, or a percentage. */
const isKindWord = (w) => GRADES.has(w) || w.endsWith('%')
/**
 * Construct forms of the same word ("ביצי חופש" is "ביצים חופש", "תפוחי אדמה" is "תפוח
 * אדמה"). Listed, not a rule: "חלבי" is not "חלב".
 */
const SAME_WORD = new Map([['ביצי', 'ביצ'], ['תפוחי', 'תפוח']])
for (const [grade, words] of Object.entries(GRADE_WORDS)) {
  for (const w of words) SAME_WORD.set(foldSuffix(normalizeName(w)), grade)
}

/**
 * Crude singular/plural folding: "עגבניה"/"עגבניות" → "עגבני", "מלפפון"/"מלפפונים"
 * → "מלפפונ". Only strips when at least 3 letters remain ("תות" stays "תות").
 * Runs on normalized text, so the plural suffix is "ימ" (final מ already folded).
 */
export function stemWord(w) {
  const stem = foldSuffix(w)
  return SAME_WORD.get(stem) ?? stem
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
/**
 * Qualifiers that do not change the product ("גזר ארוז" is still carrots,
 * "עגבניה יומי" is still tomatoes): packaging, freshness, origin, grade.
 */
const NEUTRAL_STEMS = new Set(
  [
    'במשקל', 'תפזורת', 'בתפזורת', 'שקיל', 'ארוז', 'ארוזה', 'ארוזות', 'בקרטון', 'בשקית',
    'טרי', 'טריה', 'טריים', 'יומי', 'מובחר', 'פרימיום', 'איכותי', 'ישראלי', 'ישראל',
    'מקומי', 'חממה', 'מהחממה', 'קרטון', 'בקבוק', 'בבקבוק', 'שקית', 'מהדרין', 'בדץ', 'כשר', 'כשרה',
    'רגיל',
  ].map((w) => stemName(w)),
)

function isBlocked(stem) {
  return BLOCK_STEMS.some((b) => stem.startsWith(b))
}

/**
 * The identity of a weighed product across spellings: its stemmed words minus
 * neutral qualifiers, so "עגבניה", "עגבנייה", "עגבניות ישראל" and "עגבניה יומי"
 * all become "עגבני". Falls back to the full stem when nothing else remains.
 */
export function canonicalWeighed(name) {
  const words = stemName(name).split(' ').filter(Boolean)
  const kept = words.filter((w) => !NEUTRAL_STEMS.has(w))
  return (kept.length ? kept : words).join(' ')
}

/** Words that only say how much: "1 ליטר", "750ג", "12 יח". */
const UNIT_WORDS = new Set(
  ['ל', 'ליטר', 'ליטרים', 'מל', 'מיליליטר', 'ג', 'גר', 'גרם', 'ק', 'קג', 'קילו', 'קילוגרם',
    'יח', 'יחי', 'יחיד', 'יחידה', 'יחידות', 'מטר', 'מטרים', 'גליל', 'גלילים', 'רולים'].map(normalizeName),
)
const SIZE_WORD = /^\d+(?:ל|ליטר|מל|ג|גר|גרמ|ק|קג|קילו|יח|יחי|יחיד|יחידה|יחידות|מ|מטר|l|ml|g|gr|kg)?$/
const isSizeWord = (w) => UNIT_WORDS.has(w) || SIZE_WORD.test(w) || w === 'ml' || w === 'kg'
const FAT = stemWord('שומנ')

const tokenCache = new Map()

/**
 * What a product name says about WHAT it is: its words (`s`) and their stems (`t`),
 * minus sizes and neutral qualifiers, so "משקה שיבולת שועל1ל" and "משקה שיבולת שועל
 * 1 ליטר" are the same thing. A percentage is one word however it is written ("%3",
 * "3 %", "3% שומן"). Cached: branch files repeat the same names.
 */
export function productTokens(name) {
  const key = String(name)
  const hit = tokenCache.get(key)
  if (hit) return hit
  const text = key
    .replace(/(?<!\d)%(\d+(?:[.,]\d+)?)/g, '$1%')
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/(\d)[.,](\d+%)/g, '$1·$2') // a decimal point inside a percentage is not a word break
    .replace(/(\p{L})(\d)/gu, '$1 $2')
  const t = []
  const s = []
  let number = 0 // the number right before this word, if any
  for (const word of text.split(/[\s,.\-/()+*:&;#!_=[\]|]+/)) {
    const norm = normalizeName(word)
    // "1.5 L" is liters; "12 L" is a dozen of size L.
    const liters = norm === 'l' && number > 0 && number <= 5
    number = /^\d+$/.test(norm) ? Number(norm) : 0
    if (!norm || liters || isSizeWord(norm)) continue
    const stem = stemWord(norm)
    if (NEUTRAL_STEMS.has(stem)) continue
    if (stem === FAT && t.at(-1)?.endsWith('%')) continue
    const surface = word.replace(/^["'`״׳]+|["`״]+$/g, '').replace('·', '.')
    if (GRADES.has(stem)) {
      const letter = /^[a-z]+$/i.test(surface)
      const at = t.indexOf(stem)
      if (at !== -1) {
        // "גדול L" says L twice; the letter is the name people recognize.
        if (letter) s[at] = stem.toUpperCase()
        continue
      }
      t.push(stem)
      s.push(letter ? stem.toUpperCase() : surface)
      continue
    }
    t.push(stem)
    s.push(surface)
  }
  const out = { t, s }
  tokenCache.set(key, out)
  return out
}

/** One field of an <Item> block; handles `<Tag>`, `<Tag >` and an empty `<Tag />`. */
function field(block, name) {
  const needle = '<' + name
  let at = block.indexOf(needle)
  while (at !== -1) {
    const next = block[at + needle.length]
    if (next === '>' || next === ' ' || next === '/') break
    at = block.indexOf(needle, at + 1)
  }
  if (at === -1) return ''
  const gt = block.indexOf('>', at)
  if (gt === -1 || block[gt - 1] === '/') return ''
  const end = block.indexOf('<', gt + 1)
  return end === -1 ? '' : block.slice(gt + 1, end).trim()
}

const interned = new Map()

/** Every priced item of a branch file, in one pass. */
export function parseItems(xml) {
  // A slice keeps its whole parent string alive; names outlive the 20 MB file text.
  const own = (str) => {
    let v = interned.get(str)
    if (v === undefined) {
      v = Buffer.from(str).toString()
      interned.set(v, v)
    }
    return v
  }
  const out = []
  let at = xml.indexOf('<ItemCode')
  while (at !== -1) {
    const next = xml.indexOf('<ItemCode', at + 9)
    const block = xml.slice(at, next === -1 ? undefined : next)
    at = next
    const name = unescapeHtml(field(block, 'ItemName')).replace(/\s+/g, ' ').trim()
    const price = Number.parseFloat(field(block, 'ItemPrice'))
    if (name.length < 2 || !(price > 0)) continue
    out.push({
      code: own(field(block, 'ItemCode')),
      name: own(name),
      price,
      weighed: field(block, 'bIsWeighted') === '1',
      maker: own(field(block, 'ManufactureName')),
      qty: field(block, 'Quantity'),
      unitQty: field(block, 'UnitQty'),
      uom: field(block, 'UnitOfMeasure'),
    })
  }
  return out
}

function sizeKey(amount, unit) {
  const a = Number.parseFloat(String(amount).replace(',', '.'))
  if (!(a > 0)) return ''
  const u = String(unit).replace(/["״׳']/g, '')
  if (u.includes('מיליליטר') || u === 'מל') return 'ml' + Math.round(a)
  if (u.includes('ליטר') || u === 'ל') return 'ml' + Math.round(a * 1000)
  if (u.includes('קילו') || u === 'קג') return 'g' + Math.round(a * 1000)
  if (u.includes('גרם') || u === 'גר' || u === 'ג') return 'g' + Math.round(a)
  if (u.includes('יח') || u.includes('גליל') || u.includes('רול')) return 'u' + Math.round(a)
  if (u.includes('מטר')) return 'm' + Math.round(a)
  return ''
}

const NAME_SIZE = /(\d+(?:[.,]\d+)?)\s*(מ["״]?ל|מיליליטר|ליטרים|ליטר|ל|ק["״]?ג|קילוגרם|קילו|גרם|גר|ג|יחידות|יחידה|יחי|יח|גלילים|גליל|רולים)(?!\p{L})/u

/** Pack size as a comparable key ("ml1000", "g750", "u12"). The name is printed on the pack, so it wins. */
export function productSize(name, qty = '', unitQty = '', uom = '') {
  const m = String(name).match(NAME_SIZE)
  const fromName = m ? sizeKey(m[1], m[2]) : ''
  if (fromName) return fromName
  for (const unit of [unitQty, uom]) {
    if (!unit || unit === 'לא ידוע') continue
    const key = sizeKey(qty, unit)
    // "1 גרם" / "1 מ״ל" is a placeholder, not a pack size.
    if (key && !/^(ml|g)[01]$/.test(key)) return key
  }
  return ''
}

export function sizeLabel(key) {
  const m = String(key).match(/^(ml|g|u|m)(\d+)$/)
  if (!m) return ''
  const v = Number(m[2])
  if (m[1] === 'ml') return v >= 1000 ? `${v / 1000} ליטר` : `${v} מ״ל`
  if (m[1] === 'g') return v >= 1000 ? `${v / 1000} ק״ג` : `${v} גרם`
  if (m[1] === 'u') return v > 1 ? `${v} יח׳` : ''
  return `${v} מטר`
}

/** Extras that make it a different thing than the generic name ("חלב בטעם תות"). */
const FAMILY_BLOCK = [
  'בטעם', 'טעם', 'מארז', 'מיני', 'מיקס', 'מבחר', 'ממרח', 'אבקת', 'מיץ', 'רסק', 'מחית',
  'סלט', 'תבלין', 'שלוק', 'מיובש', 'כבוש', 'ברוטב', 'במלח', 'בחומץ',
  'וניל', 'שוקולד', 'תות', 'מאצה', 'קפוצינו', 'קרמל', 'מנגו', 'אננס', 'אפרסק',
].map((w) => stemWord(normalizeName(w)))

function familyEnd(tokens, query, p, cut) {
  for (let i = 0; i < query.length; i++) {
    const t = tokens[p + i]
    if (t === query[i]) continue
    // The chain cut the name off mid-word here ("משקה שיבולת ש"); that still counts.
    if (cut && i > 0 && p + i === tokens.length - 1 && t && query[i].startsWith(t)) return tokens.length
    return -1
  }
  return p + query.length
}

/** A name cut mid-word still counts: "משקה שיבולת שועל בטע" is flavored. */
const familyBlocked = (extras, cut) =>
  extras.some((x, i) =>
    FAMILY_BLOCK.some(
      (b) => x.startsWith(b) || (cut && i === extras.length - 1 && x.length >= 2 && b.startsWith(x)),
    ),
  )

/**
 * Does a packaged item belong to the generic product `query` (stems)? The name must
 * start with it: Hebrew puts the head noun first, so "שמפו ... שמן זית" is shampoo
 * and "שוקולד חלב" is chocolate. A word the file itself gives as the manufacturer says
 * who made it, not what it is, so it may come before the name ("יטבתה שמנת חמוצה") or
 * inside it ("חלב תנובה 3%" is "חלב 3%"). Any other word in between makes it another
 * kind: "חלב דל לקטוז 1%" is not "חלב 1%", and "ביצים אומגה L" is not "ביצים L".
 */
export function matchesFamily(item, tokens, query) {
  if (!query.length || !tokens.includes(query[0])) return false // the common case, and it's hot
  const cut = item.name.length >= 18 && item.name.length <= 24
  const verdict = (list, p) => {
    const end = familyEnd(list, query, p, cut)
    return end === -1 ? null : !familyBlocked(list.slice(end), cut)
  }
  const direct = verdict(tokens, 0)
  if (direct !== null) return direct
  const maker = new Set(productTokens(item.maker ?? '').t)
  if (!maker.size) return false
  for (let p = 0; p < tokens.length && maker.has(tokens[p]); p++) {
    const v = verdict(tokens, p + 1)
    if (v !== null) return v
  }
  if (maker.has(tokens[0])) return false // the maker is named after the product ("שמן זית יד מרדכי")
  return verdict(tokens.filter((x, i) => i === 0 || !maker.has(x)), 0) === true
}

/** A product name prepared for matchWeighed. */
export function weighedQuery(name) {
  return { norm: normalizeName(name), canon: canonicalWeighed(name) }
}

/**
 * Best weighed item for a product name: the same name (score 0), the same
 * product under another spelling ("עגבניות"/"עגבנייה"/"עגבניה יומי", 0.5), else
 * the product followed by further plain qualifiers (1 + extra words), never a
 * blocked one. Ties go to the cheaper item.
 */
export function matchWeighed(weighted, query) {
  const { norm, canon } = query
  if (!canon) return null
  let best = null
  for (const w of weighted) {
    let score
    if (w.norm === norm) {
      score = 0
    } else if (w.canon === canon) {
      score = 0.5
    } else if (w.canon.startsWith(canon + ' ')) {
      const extra = w.canon.slice(canon.length + 1).split(' ')
      if (extra.some(isBlocked)) continue
      score = 1 + extra.length
    } else {
      continue
    }
    if (!best || score < best.score || (score === best.score && w.price < best.price)) {
      best = { ...w, score }
    }
  }
  return best
}

// ---------------------------------------------------------------- product catalog

const CATALOG_MAX_DEPTH = 5
/** Words that cannot end a product name: the rest of the phrase was cut off. */
const DANGLING = new Set(['בטעם', 'טעם', 'עם', 'ללא', 'בלי', 'של', 'על', 'את', 'או', 'לא', 'נטול', 'דל'].map((w) => stemWord(normalizeName(w))))

/**
 * The names the app offers while typing: GENERIC products, one row per name —
 * never one row per barcode or per chain. Every product's words form a path in a
 * tree ("משקה" → "שיבולת" → "שועל"); a node is offered when several products share
 * it, so 23 oat-drink barcodes become the single row "משקה שיבולת שועל", and the
 * job computes each branch's cheapest of them (matchesFamily). Weighed goods merge
 * across spellings the same way, because sizes and neutral words are not in the path.
 */
class Catalog {
  constructor() {
    this.chains = [] // index → display name
    this.products = new Map() // barcode or weighed name → { name, names, weighed, mask }
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

  add(items, chainKey, chainName) {
    this.filesPerChain[chainKey] = (this.filesPerChain[chainKey] ?? 0) + 1
    const bit = 1 << this.chainIndex(chainName)
    for (const it of items) {
      const { t } = productTokens(it.name)
      if (!t.length) continue
      if (!it.weighed && !/^\d{3,}$/.test(it.code)) continue
      const id = it.weighed ? 'w' + t.join(' ') : 'c' + it.code
      let e = this.products.get(id)
      if (!e) {
        this.products.set(id, (e = { name: it.name, maker: it.maker, names: new Map(), weighed: it.weighed, mask: 0 }))
      }
      // Chains truncate names differently; keep the most complete one.
      if (it.name.length > e.name.length) {
        e.name = it.name
        e.maker = it.maker
      }
      e.names.set(it.name, (e.names.get(it.name) ?? 0) + 1)
      e.mask |= bit
    }
  }

  /** Compact shape: `families: [name, chainMask, productCount, weighed(0|1)][]`. */
  toJSON() {
    const products = [...this.products.values()]
    // Cerberus chains cut names at 20 chars, leaving half words ("…שועל אור"). A last
    // word only counts if it also appears somewhere it cannot have been cut.
    const whole = new Set()
    for (const e of products) {
      const { t } = productTokens(e.name)
      for (const x of e.name.length === 20 ? t.slice(0, -1) : t) whole.add(x)
    }

    // "אלפרו משקה שיבולת שועל" (maker אלפרו) belongs on the row "משקה שיבולת שועל", as
    // in matchesFamily. A lone word after the brand stays put: "קוקה קולה זירו" ≠ "זירו".
    // A maker inside the name gives two paths, because both are real choices: "חלב
    // תנובה 3%" is under "חלב 3%" and also under the brand "חלב תנובה".
    const pathsOf = (e) => {
      const { t, s } = productTokens(e.name)
      if (e.weighed) return [{ t, s }]
      const maker = new Set(productTokens(e.maker ?? '').t)
      let lead = 0
      while (lead < t.length && maker.has(t[lead])) lead++
      if (lead > 0) return [lead > 0 && t.length - lead >= 2 ? { t: t.slice(lead), s: s.slice(lead) } : { t, s }]
      const keep = t.map((x, i) => i === 0 || !maker.has(x))
      if (keep.every(Boolean)) return [{ t, s }]
      return [{ t, s }, { t: t.filter((_, i) => keep[i]), s: s.filter((_, i) => keep[i]) }]
    }

    const nodes = new Map()
    for (const e of products) {
      const counted = new Set() // a product with two paths still counts once per node
      for (const path of pathsOf(e)) {
        let { t } = path
        if (e.name.length === 20 && t.length > 1 && !whole.has(t[t.length - 1])) t = t.slice(0, -1)
        for (let d = 1; d <= Math.min(t.length, CATALOG_MAX_DEPTH); d++) {
          const key = t.slice(0, d).join(' ')
          if (counted.has(key)) continue
          counted.add(key)
          let n = nodes.get(key)
          if (!n) nodes.set(key, (n = { key, count: 0, w: 0, wMask: 0, plainW: false, mask: 0, surf: new Map(), maxKid: 0, whole: false }))
          n.count++
          n.mask |= e.mask
          // This word cannot have been cut off if a name goes on after it, or is not cut-length.
          if (d < t.length || e.name.length < 18 || e.name.length > 24) n.whole = true
          if (e.weighed) {
            n.w++
            n.wMask |= e.mask
            if (d === t.length) n.plainW = true
          }
          if (e.weighed) {
            for (const [nm, c] of e.names) {
              const surface = productTokens(nm).s.slice(0, d).join(' ')
              n.surf.set(surface, (n.surf.get(surface) ?? 0) + c)
            }
          } else {
            const surface = path.s.slice(0, d).join(' ')
            n.surf.set(surface, (n.surf.get(surface) ?? 0) + 1)
          }
        }
      }
    }
    const siblingWords = new Map() // parent key → the words that continue it
    for (const n of nodes.values()) {
      const cut = n.key.lastIndexOf(' ')
      if (cut === -1) continue
      const parent = nodes.get(n.key.slice(0, cut))
      // A size or percentage never swallows its parent: "ביצים אומגה" stays a row even if most are L.
      if (parent && !isKindWord(n.key.slice(cut + 1))) parent.maxKid = Math.max(parent.maxKid, n.count)
      const parentKey = n.key.slice(0, cut)
      if (!siblingWords.has(parentKey)) siblingWords.set(parentKey, [])
      siblingWords.get(parentKey).push(n.key.slice(cut + 1))
    }

    const families = []
    for (const n of nodes.values()) {
      // A node most of whose products continue with one word is that word's node
      // ("משקה שיבולת" → "משקה שיבולת שועל"), unless it is a plain produce name or a
      // single word, which people do type on its own ("קוטג").
      // Nor is a size or percentage swallowed: "כפפות ניטריל S" stays even if most are one brand.
      const dominated =
        n.key.includes(' ') && n.maxKid >= 2 && n.maxKid >= 0.5 * n.count && !n.plainW &&
        !isKindWord(n.key.slice(n.key.lastIndexOf(' ') + 1))
      if (dominated) continue
      // Offered: what several products share, or a product alone under its first word.
      if (n.count < 2 && !(n.maxKid === 0 && nodes.get(n.key.split(' ')[0]).count === 1)) continue
      // One chain's stray listing ("עגבנ") is not worth offering; typing it still works.
      let chainCount = 0
      for (let bits = n.mask; bits > 0; bits >>= 1) chainCount += bits & 1
      if (chainCount < 2 && n.count < 3) continue
      const words = n.key.split(' ')
      const lastWord = words[words.length - 1]
      const grade = GRADES.has(lastWord)
      // Where any chain writes a size as a letter, the row says the letter.
      const surfaces = [...n.surf.entries()]
      const letters = grade ? surfaces.filter(([x]) => /[A-Z]+$/.test(x)) : []
      const name = (letters.length ? letters : surfaces).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
      if (name.length < 2) continue
      const tiny = /^[\u0590-\u05FF]{1,2}$/.test(lastWord)
      if (words.length > 1 ? DANGLING.has(lastWord) || tiny : tiny && n.count < 5) continue
      // A word cut off mid-way, with the whole word right beside it ("אור" / "אורגני").
      // Only where every product could be cut: "ספגטי" beside "ספגטיני" is a real word.
      const siblings = siblingWords.get(n.key.slice(0, n.key.lastIndexOf(' '))) ?? []
      if (!n.whole && !grade && words.length > 1 && siblings.some((w) => w.length > lastWord.length && w.startsWith(lastWord))) continue
      // Sold by weight when most chains that have it do, as in kindOf: "מלפפון" beats the
      // pickles and "בצל" counts its "בצל יבש", but one chain's deli does not make "שמנת
      // חמוצה" a price per kg.
      let weighedChains = 0
      for (let bits = n.wMask; bits > 0; bits >>= 1) weighedChains += bits & 1
      const byWeight = n.w === n.count || (n.w > 0 && weighedChains >= 0.5 * chainCount)
      families.push([name, n.mask, n.count, byWeight ? 1 : 0])
    }
    return { updatedAt: new Date().toISOString(), chains: this.chains, families }
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
    // Legacy pins were a bare barcode string; new ones are {kind, code?, codes?, name?}.
    if (v?.stringValue) pins[k] = { kind: 'barcode', code: v.stringValue }
    const mf = v?.mapValue?.fields
    if (mf) {
      const code = mf.code?.stringValue ?? ''
      const codes = (mf.codes?.arrayValue?.values ?? []).map((c) => c.stringValue).filter(Boolean)
      pins[k] = {
        kind: ['weighed', 'family'].includes(mf.kind?.stringValue) ? mf.kind.stringValue : 'barcode',
        code,
        codes: [...new Set([code, ...codes])].filter(Boolean),
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
 *   kind 'weighed' — pinned produce name: matched by name among weighed items
 *   kind 'family'  — pinned generic name: each branch's cheapest matching item
 *   kind 'barcode' — pinned exact code, looked up in every file
 *   kind 'auto'    — unpinned: decided after all files are read, by coverage
 *                    (see kindOf in main); chp supplies only the fallback barcode.
 */
async function resolveProducts(products, pins) {
  const resolved = []
  const failures = []
  await mapLimit(products, 6, async (p) => {
    const k = p.k || nameKeyOf(p.n)
    const pin = pins[k]
    if (pin?.kind === 'weighed' || pin?.kind === 'family') {
      const name = pin.name || p.n
      resolved.push({ k, n: p.n, kind: pin.kind, name, product: name, pinned: true, candidates: [] })
      return
    }
    if (pin?.code) {
      resolved.push({
        k,
        n: p.n,
        kind: 'barcode',
        barcode: pin.code,
        // The same product under several codes: price whichever a branch has.
        codes: pin.codes?.length ? pin.codes : [pin.code],
        product: pin.name || p.n,
        pinned: true,
        candidates: [],
      })
      return
    }
    let candidates = []
    try {
      candidates = (await chpAutocomplete(p.n)).slice(0, 6)
    } catch (e) {
      failures.push(`${p.n}: ${e.message}`) // chp is only a fallback; the name still gets priced
    }
    const top = candidates[0]
    const chpWeighed = !!top && /לפי משקל/.test(top.name)
    resolved.push({
      k,
      n: p.n,
      kind: 'auto',
      name: p.n,
      product: p.n,
      barcode: top && !chpWeighed ? top.barcode : undefined,
      barcodeName: top?.name,
      chpWeighed,
      // Nothing known about the name: only a (near-)exact weighed name can price it.
      strict: !top,
      candidates,
    })
  })
  return { resolved, failures }
}

const PUBLISHED_CATALOG = 'https://raw.githubusercontent.com/ofekSro/kniot/data/catalog.json'
const MAX_PRICED_CHOICES = 8 // what the app shows before "עוד"
const GRADE_ORDER = [...GRADES]

/**
 * The choices the app offers around each tracked name (the published catalog's rows one
 * step narrower, its siblings, its parent), so that picking one has a price right away
 * instead of waiting for the next run. Priced for the first city only, to keep
 * prices.json small: elsewhere a picked choice is tracked and priced on the next run.
 * Same selection as choicesOf in src/lib/catalog.ts.
 */
async function choicesToPrice(resolved, source) {
  let rows
  try {
    const raw = /^https?:/.test(source)
      ? await (await fetch(source)).json()
      : JSON.parse(readFileSync(source, 'utf-8'))
    rows = raw.families.map(([name, mask, count, weighed]) => {
      let chains = 0
      for (let bits = mask; bits > 0; bits >>= 1) chains += bits & 1
      return { name, chains, count, weighed: weighed === 1, t: productTokens(name).t }
    })
  } catch {
    return [] // only a nicety: the names themselves are still priced
  }
  const startsWith = (t, prefix) => t.length >= prefix.length && prefix.every((x, i) => t[i] === x)
  // Sizes in scale order, then percentages ascending, then by how widely sold.
  const orderOf = (added) => {
    const rest = GRADE_ORDER.length + 1
    if (added.length !== 1) return rest
    const grade = GRADE_ORDER.indexOf(added[0])
    if (grade !== -1) return grade
    const percent = /^(\d+)%$/.exec(added[0])
    return percent ? GRADE_ORDER.length + Number(percent[1]) / 1000 : rest
  }
  const childrenOf = (parent) => {
    const below = rows.filter((r) => r.t.length > parent.length && startsWith(r.t, parent))
    const order = (r) => orderOf(r.t.slice(parent.length))
    return below
      .filter((r) => !below.some((o) => o.t.length < r.t.length && startsWith(r.t, o.t)))
      .sort((a, b) => order(a) - order(b) || b.chains - a.chains || b.count - a.count)
      .slice(0, MAX_PRICED_CHOICES)
  }
  const taken = new Set(resolved.map((r) => r.k))
  const out = []
  const add = (row) => {
    const k = nameKeyOf(row.name)
    if (taken.has(k)) return
    taken.add(k)
    out.push({
      k,
      n: row.name,
      kind: row.weighed ? 'weighed' : 'family',
      name: row.name,
      product: row.name,
      pinned: false,
      candidates: [],
      choice: true,
    })
  }
  for (const r of resolved) {
    if (!r.name) continue
    const { t } = productTokens(r.name)
    if (!t.length) continue
    childrenOf(t).forEach(add)
    for (let d = t.length - 1; d > 0; d--) {
      const parent = t.slice(0, d)
      const row = rows.find((x) => x.t.length === d && startsWith(x.t, parent))
      if (!row) continue
      add(row)
      childrenOf(parent).forEach(add)
      break
    }
  }
  return out
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
  const choices = await choicesToPrice(resolved, opt('catalog', PUBLISHED_CATALOG))
  resolved.push(...choices)
  const choiceKeys = new Set(choices.map((r) => r.k))
  const wantedBarcodes = new Set(resolved.flatMap((r) => r.codes ?? (r.barcode ? [r.barcode] : [])))
  const weighedQueries = resolved
    .filter((r) => r.kind === 'weighed' || r.kind === 'auto')
    .map((r) => ({ k: r.k, strict: !!r.strict, ...weighedQuery(r.name) }))
    .filter((q) => q.canon)
  const familyQueries = resolved
    .filter((r) => r.kind === 'family' || r.kind === 'auto')
    .map((r) => ({ k: r.k, tokens: productTokens(r.name).t }))
    .filter((q) => q.tokens.length)
  const kinds = ['barcode', 'weighed', 'family', 'auto'].map((x) => `${x} ${resolved.filter((r) => r.kind === x).length}`)
  console.log(`resolved ${resolved.length - choices.length}/${products.length} products + ${choices.length} choices (${kinds.join(', ')}); cities: ${cities.length}`)

  mkdirSync(outDir, { recursive: true })
  const failures = [...resolveFailures]
  const catalog = new Catalog()
  // For 'auto' products, per branch file: priced by the chp barcode / had this very
  // produce by name (exact) / any weighed match / any packaged item of the family.
  // Decided after all files, by coverage, so one chain's deli "שמנת חמוצה" cannot
  // hijack what every store sells packaged, while "מלפפון" (weighed everywhere)
  // beats the family of pickles.
  const barcodeHits = {}
  const exactHits = {}
  const looseHits = {}
  const familyHits = {}
  const familySizeHits = {} // k → pack size → branch files stocking that size
  const autoByBarcode = new Map()
  for (const r of resolved) {
    if (r.kind !== 'auto') continue
    if (!autoByBarcode.has(r.barcode)) autoByBarcode.set(r.barcode, [])
    autoByBarcode.get(r.barcode).push(r.k)
  }

  // Per-city accumulators.
  const acc = {}
  for (const city of cities) acc[city] = { stores: [], priceByBarcode: {}, weighedByKey: {}, familyByKey: {} }

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
      const fileItems = parseItems(xml)
      // Choices are priced for the first city only (see choicesToPrice).
      const home = t.city === cities[0]
      for (const it of fileItems) {
        if (!wantedBarcodes.has(it.code)) continue
        slice.priceByBarcode[it.code] ??= {}
        const prev = slice.priceByBarcode[it.code][key]
        if (prev == null || it.price < prev) slice.priceByBarcode[it.code][key] = it.price
        for (const k of autoByBarcode.get(it.code) ?? []) barcodeHits[k] = (barcodeHits[k] ?? 0) + 1
      }
      if (weighedQueries.length) {
        const weighted = fileItems.filter((i) => i.weighed).map((i) => ({ ...i, ...weighedQuery(i.name) }))
        for (const q of weighedQueries) {
          if (!home && choiceKeys.has(q.k)) continue
          const m = matchWeighed(weighted, q)
          if (!m || (q.strict && m.score > 0.5)) continue
          slice.weighedByKey[q.k] ??= {}
          slice.weighedByKey[q.k][key] = { price: m.price, name: m.name }
          looseHits[q.k] = (looseHits[q.k] ?? 0) + 1
          if (m.score <= 0.5) exactHits[q.k] = (exactHits[q.k] ?? 0) + 1
        }
      }
      if (familyQueries.length) {
        const sizesSeen = new Map() // k → Set of sizes in this file
        for (const it of fileItems) {
          if (it.weighed) continue
          const { t: tokens } = productTokens(it.name)
          for (const q of familyQueries) {
            if (!matchesFamily(it, tokens, q.tokens)) continue
            if (!home && choiceKeys.has(q.k)) continue
            const size = productSize(it.name, it.qty, it.unitQty, it.uom)
            slice.familyByKey[q.k] ??= {}
            const bySize = (slice.familyByKey[q.k][key] ??= {})
            if (!bySize[size] || it.price < bySize[size].price) {
              bySize[size] = { price: it.price, code: it.code, name: it.name }
            }
            if (!sizesSeen.has(q.k)) sizesSeen.set(q.k, new Set())
            sizesSeen.get(q.k).add(size)
          }
        }
        for (const [k, sizes] of sizesSeen) {
          familyHits[k] = (familyHits[k] ?? 0) + 1
          familySizeHits[k] ??= {}
          for (const size of sizes) familySizeHits[k][size] = (familySizeHits[k][size] ?? 0) + 1
        }
      }
      if (catalog.wants(t.branch.chain)) catalog.add(fileItems, t.branch.chain, t.branch.chainName)
    } catch (e) {
      failures.push(`${t.city} ${t.branch.chainName} ${t.branch.id}: ${e.message}`)
    }
    if (++done % 50 === 0) console.log(`  …${done}/${tasks.length}`)
  })

  const kindOf = (r) => {
    if (r.kind !== 'auto') return r.kind
    const exact = exactHits[r.k] ?? 0
    const family = familyHits[r.k] ?? 0
    const barcode = barcodeHits[r.k] ?? 0
    if (exact > 0 && exact >= 0.5 * Math.max(family, barcode)) return 'weighed'
    if (r.chpWeighed && (looseHits[r.k] ?? 0) > 0) return 'weighed'
    if (family > 0) return 'family'
    if (barcode > 0) return 'barcode'
    return 'weighed'
  }

  const familyRows = new Map(
    resolved
      .filter((r) => r.kind === 'family' || r.kind === 'auto')
      .map((r) => [productTokens(r.name).t.join(' '), r]),
  )
  const parentOf = (r) => {
    const { t } = productTokens(r.name)
    for (let d = t.length - 1; d > 0; d--) {
      const p = familyRows.get(t.slice(0, d).join(' '))
      if (p && kindOf(p) === 'family') return p
    }
    return null
  }

  /**
   * The one pack size a family is compared on: what the name says, else the parent's
   * while that is well stocked ("חלב 3%" per liter, like "חלב"), else the most stocked.
   */
  const familySize = (r) => {
    const hits = familySizeHits[r.k] ?? {}
    const named = productSize(r.name)
    if (named && hits[named]) return named
    let best = ''
    let bestScore = -1
    for (const [size, n] of Object.entries(hits)) {
      const score = size ? n : n / 4 // an unknown size is a poor thing to compare on
      if (score > bestScore) {
        best = size
        bestScore = score
      }
    }
    const parent = parentOf(r)
    if (parent) {
      const size = familySize(parent)
      if (size && (hits[size] ?? 0) >= 0.7 * bestScore) return size
    }
    return best
  }

  /** Per-branch prices that may come from different items: which item at which branch. */
  const collectVariants = (entries) => {
    const byStore = {}
    const pick = {}
    const variants = []
    const indexByCode = new Map()
    for (const [storeKey, v] of entries) {
      byStore[storeKey] = v.price
      if (!indexByCode.has(v.code)) indexByCode.set(v.code, variants.push({ c: v.code, n: v.name }) - 1)
      pick[storeKey] = indexByCode.get(v.code)
    }
    return { byStore, pick, variants }
  }

  const byCity = {}
  for (const city of cities) {
    const slice = acc[city]
    const priceable = city === cities[0] ? resolved : resolved.filter((r) => !choiceKeys.has(r.k))
    const items = priceable.map((r) => {
      const kind = kindOf(r)
      const common = { k: r.k, n: r.n, pinned: r.pinned ?? false, candidates: r.candidates }
      if (kind === 'weighed') {
        const hits = slice.weighedByKey[r.k] ?? {}
        const byStore = {}
        const names = new Map()
        for (const [sk, h] of Object.entries(hits)) {
          byStore[sk] = h.price
          names.set(h.name, (names.get(h.name) ?? 0) + 1)
        }
        const product = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.product
        return { ...common, kind: 'weighed', unit: 'kg', barcode: '', product, byStore }
      }
      if (kind === 'family') {
        const size = familySize(r)
        const entries = Object.entries(slice.familyByKey[r.k] ?? {})
          .filter(([, sizes]) => sizes[size])
          .map(([sk, sizes]) => [sk, sizes[size]])
        const label = productSize(r.name) === size ? '' : sizeLabel(size)
        return {
          ...common,
          kind: 'family',
          barcode: '',
          product: label ? `${r.name} · ${label}` : r.name,
          ...collectVariants(entries),
        }
      }
      const codes = r.codes ?? [r.barcode]
      const best = new Map()
      for (const code of codes) {
        for (const [sk, price] of Object.entries(slice.priceByBarcode[code] ?? {})) {
          if (!best.has(sk) || price < best.get(sk).price) best.set(sk, { price, code, name: r.product })
        }
      }
      const { byStore, pick, variants } = collectVariants([...best])
      return {
        ...common,
        kind: 'barcode',
        barcode: r.barcode,
        ...(codes.length > 1 ? { pick, variants } : {}),
        product: r.kind === 'auto' ? (r.barcodeName ?? r.product) : r.product,
        byStore,
      }
    }).filter((it) => !choiceKeys.has(it.k) || Object.keys(it.byStore).length > 0)
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
    items: first.items.filter((it) => !choiceKeys.has(it.k)),
  }
  writeFileSync(join(outDir, 'prices.json'), JSON.stringify(payload))
  writeFileSync(
    join(outDir, 'branches.json'),
    JSON.stringify(Object.fromEntries(cities.map((c) => [c, byCity[c].stores.length])), null, 1),
  )
  const cat = catalog.toJSON()
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(cat))
  console.log(
    `\nwrote ${cities.length} cities, ${tasks.length} branches; catalog: ${cat.families.length} names from ${cat.chains.length} chains`,
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
