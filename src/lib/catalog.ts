import type { ProductLink } from './prices'

/**
 * The product catalog built nightly by scripts/fetchPrices.mjs from the chains'
 * own price files, so that typing in the add bar can offer CONCRETE products
 * (a specific barcode, or a weighed produce name) instead of a bare name the
 * job then has to guess. Every entry here is something the job can price.
 */
export interface CatalogEntry {
  /** National barcode — absent for weighed goods. */
  code?: string
  name: string
  weighed: boolean
  /** Display names of the chains that stock it. */
  chains: string[]
  /** Lowercased, whitespace-collapsed name for matching. */
  q: string
}

export interface Catalog {
  updatedAt: string
  entries: CatalogEntry[]
}

/** Compact nightly shape: rows are `[name, chainMask, barcode?]` (no barcode = weighed). */
interface RawCatalog {
  updatedAt: string
  chains: string[]
  products: [string, number, string?][]
}

const CATALOG_URL = 'https://raw.githubusercontent.com/ofekSro/kniot/data/catalog.json'

function norm(s: string): string {
  return s.toLowerCase().replace(/["'`״׳]/g, '').replace(/\s+/g, ' ').trim()
}

/** Fetch the catalog; null on any failure (the add bar then just has no product rows). */
export async function fetchCatalog(): Promise<Catalog | null> {
  try {
    const res = await fetch(CATALOG_URL)
    if (!res.ok) return null
    const raw = (await res.json()) as RawCatalog | null
    if (!raw || !Array.isArray(raw.products)) return null
    const chains = Array.isArray(raw.chains) ? raw.chains : []
    const entries: CatalogEntry[] = []
    for (const row of raw.products) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue
      const [name, mask, code] = row
      const weighed = !code
      entries.push({
        code: weighed ? undefined : code,
        name,
        weighed,
        chains: chains.filter((_, i) => (Number(mask) >> i) & 1),
        q: norm(name),
      })
    }
    return { updatedAt: raw.updatedAt, entries }
  } catch {
    return null
  }
}

/**
 * Products matching what was typed: names that start with the query first, then
 * names with a word that starts with it. Within a tier, weighed (generic produce)
 * before packaged, then shorter names — "מלפפון" before "מלפפון בחומץ 560 גרם".
 */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  limit = 6,
): CatalogEntry[] {
  const q = norm(query)
  if (q.length < 2) return []
  const scored: { e: CatalogEntry; score: number }[] = []
  for (const e of entries) {
    let score: number
    if (e.q.startsWith(q)) score = 0
    else if (e.q.includes(' ' + q)) score = 1
    else continue
    scored.push({ e, score })
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.e.weighed) - Number(a.e.weighed) ||
      a.e.q.length - b.e.q.length ||
      a.e.q.localeCompare(b.e.q, 'he'),
  )
  return scored.slice(0, limit).map((s) => s.e)
}

export function linkOf(entry: CatalogEntry): ProductLink {
  return entry.weighed || !entry.code
    ? { kind: 'weighed', name: entry.name }
    : { kind: 'barcode', code: entry.code, name: entry.name }
}
