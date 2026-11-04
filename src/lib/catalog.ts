import type { ProductLink } from './prices'

/**
 * The names offered while typing, built nightly by scripts/fetchPrices.mjs from the
 * chains' own price files. One row per GENERIC product ("משקה שיבולת שועל"), never
 * per barcode or chain: picking it tells the job to compute each branch's cheapest
 * item of that name.
 */
export interface CatalogEntry {
  name: string
  /** Sold by weight (priced per kg) rather than as a packaged item. */
  weighed: boolean
  /** How many of the chains stock it, and how many distinct products it covers. */
  chainCount: number
  count: number
  /** The name's words, folded and stemmed, for matching what was typed. */
  words: string[]
  stems: string[]
}

export interface Catalog {
  updatedAt: string
  entries: CatalogEntry[]
}

/** Nightly shape: `families: [name, chainMask, productCount, weighed(0|1)][]`. */
interface RawCatalog {
  updatedAt: string
  families: [string, number, number, number][]
}

const CATALOG_URL = 'https://raw.githubusercontent.com/ofekSro/kniot/data/catalog.json'

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

// foldWord and stemWord mirror normalizeName and stemWord in scripts/fetchPrices.mjs:
// keep them in sync, or what was typed stops matching the job's names.
function foldWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`״׳]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .replace(/יי/g, 'י')
}

/** Words whose "suffix" is part of a different word: חלבה≠חלב, שמנת≠שמן, לבנה≠לבן. */
const NO_STEM = new Set(['חלבה', 'שמנת', 'לבנה'])

/** "עגבניה"/"עגבניות" → "עגבני", "מלפפון"/"מלפפונים" → "מלפפונ". */
function stemWord(word: string): string {
  if (NO_STEM.has(word)) return word
  for (const suffix of ['ות', 'ימ', 'ה', 'ת']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length)
    }
  }
  return word
}

function wordsOf(text: string): string[] {
  return text
    .split(/[\s,.\-/()+*:&;#!_=[\]|]+/)
    .map(foldWord)
    .filter(Boolean)
}

/** Two names with the same key are the same product under another spelling. */
export function productKey(name: string): string {
  return wordsOf(name).map(stemWord).join(' ')
}

interface Parsed {
  words: string[]
  stems: string[]
}

function parseQuery(query: string): Parsed {
  const words = wordsOf(query)
  return { words, stems: words.map(stemWord) }
}

/**
 * Where the query starts within the name's words, or -1. Finished words must be the
 * same word; the last one is still being typed, so a prefix is enough, of its
 * spelling ("מלפפ") or its stem ("עגבניות" finds "עגבניה").
 */
function matchPosition(name: Parsed, q: Parsed): number {
  const last = q.words.length - 1
  if (last < 0) return -1
  for (let p = 0; p + last < name.words.length; p++) {
    let ok = true
    for (let i = 0; i < last && ok; i++) ok = name.stems[p + i] === q.stems[i]
    if (ok) {
      const word = name.words[p + last]
      const stem = name.stems[p + last]
      if (word.startsWith(q.words[last]) || stem.startsWith(q.stems[last])) return p
    }
  }
  return -1
}

/** Does this name (a favorite, a history entry) start with what was typed? */
export function nameMatches(name: string, query: string): boolean {
  const q = parseQuery(query)
  const words = wordsOf(name)
  return matchPosition({ words, stems: words.map(stemWord) }, q) === 0
}

/** Fetch the catalog; null on any failure (the add bar then just has no product rows). */
export async function fetchCatalog(): Promise<Catalog | null> {
  try {
    const res = await fetch(CATALOG_URL)
    if (!res.ok) return null
    const raw = (await res.json()) as RawCatalog | null
    if (!raw || !Array.isArray(raw.families)) return null
    const entries: CatalogEntry[] = []
    for (const row of raw.families) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue
      const [name, mask, count, weighed] = row
      const words = wordsOf(name)
      let chainCount = 0
      for (let bits = Number(mask); bits > 0; bits >>= 1) chainCount += bits & 1
      entries.push({
        name,
        weighed: weighed === 1,
        chainCount,
        count: Number(count) || 1,
        words,
        stems: words.map(stemWord),
      })
    }
    return { updatedAt: raw.updatedAt, entries }
  } catch {
    return null
  }
}

export interface CatalogRow {
  entry: CatalogEntry
  /** Set for a narrower version of the row above it: just the words it adds. */
  subLabel?: string
}

const startsWithStems = (stems: string[], prefix: string[]) =>
  stems.length >= prefix.length && prefix.every((s, i) => stems[i] === s)

const containsStems = (stems: string[], part: string[]) => {
  for (let p = 0; p + part.length <= stems.length; p++) {
    if (part.every((s, i) => stems[p + i] === s)) return true
  }
  return false
}

const MAX_SUB_ROWS = 3

/**
 * Names matching what was typed. The most widely sold one comes first, then up to a
 * few narrower versions of it when the name is what was typed ("חלב" → 3%, עמיד…),
 * then other names. Names that merely repeat the first one behind another word
 * ("אלפרו משקה שיבולת שועל") are dropped: picking the first one covers them.
 */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  limit = 6,
): CatalogRow[] {
  const q = parseQuery(query)
  if (q.words.join('').length < 2) return []

  const matches: { e: CatalogEntry; head: boolean; exact: boolean }[] = []
  for (const e of entries) {
    const p = matchPosition(e, q)
    if (p === -1) continue
    const exact =
      q.words.join('').length >= 3 &&
      p === 0 &&
      e.stems.length === q.stems.length &&
      e.stems[q.stems.length - 1] === q.stems[q.stems.length - 1]
    matches.push({ e, head: p === 0, exact })
  }
  matches.sort(
    (a, b) =>
      Number(b.head) - Number(a.head) ||
      Number(b.exact) - Number(a.exact) ||
      b.e.chainCount - a.e.chainCount ||
      b.e.count - a.e.count ||
      a.e.name.length - b.e.name.length,
  )
  if (matches.length === 0) return []

  const first = matches[0]
  const rest = matches.slice(1).filter((m) => m.head || !first.head || q.words.length === 1)
  const children = rest.filter((m) => m.head && startsWithStems(m.e.stems, first.e.stems))
  const others: typeof matches = []
  for (const m of rest) {
    if (startsWithStems(m.e.stems, first.e.stems) || containsStems(m.e.stems, first.e.stems)) continue
    if (others.some((o) => startsWithStems(m.e.stems, o.e.stems))) continue
    others.push(m)
  }

  const rows: CatalogRow[] = [{ entry: first.e }]
  if (first.exact || others.length === 0) {
    for (const m of children.slice(0, MAX_SUB_ROWS)) {
      rows.push({
        entry: m.e,
        subLabel: m.e.name.split(' ').slice(first.e.stems.length).join(' ') || m.e.name,
      })
    }
  }
  for (const m of others) {
    if (rows.length >= limit) break
    rows.push({ entry: m.e })
  }
  return rows.slice(0, limit)
}

export function linkOf(entry: CatalogEntry): ProductLink {
  return entry.weighed
    ? { kind: 'weighed', name: entry.name }
    : { kind: 'family', name: entry.name }
}
