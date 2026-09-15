import { nameKeyOf } from './categories'

/** The public price snapshot produced nightly by scripts/fetchPrices.mjs and
 *  served from the repo's `data` branch. Keyed so the app can cross its own
 *  list items against it by nameKey with no barcode knowledge of its own. */
export interface PriceStore {
  key: string
  chain: string
  name: string
  address?: string
}

export interface PriceCandidate {
  name: string
  barcode: string
}

export interface PricedItem {
  /** nameKey — matches the app's list items. */
  k: string
  /** The tracked list name at the time of the fetch. */
  n: string
  barcode: string
  /** Canonical product that was actually priced. */
  product: string
  /** branch key → unit price. */
  byStore: Record<string, number>
  candidates?: PriceCandidate[]
}

/** One city's worth of price data. */
export interface PriceSlice {
  city?: string
  stores: PriceStore[]
  items: PricedItem[]
}

export interface PriceData {
  updatedAt: string
  /** Cities present in this snapshot (new multi-city shape). */
  cities?: string[]
  byCity?: Record<string, PriceSlice>
  /** Back-compat single-city mirror (older snapshots and the default city). */
  city?: string
  stores?: PriceStore[]
  items?: PricedItem[]
}

/** Cities the snapshot actually has branches for (empty ones are hidden). */
export function availableCities(data: PriceData | null): string[] {
  if (!data) return []
  if (data.byCity) {
    return Object.keys(data.byCity).filter((c) => (data.byCity![c].stores?.length ?? 0) > 0)
  }
  if (data.cities?.length) return data.cities
  return data.city ? [data.city] : []
}

/** The price slice for one city, or null if the snapshot has no such city. */
export function cityData(data: PriceData | null, city: string): PriceSlice | null {
  if (!data) return null
  if (data.byCity?.[city]) return data.byCity[city]
  if (data.stores && data.items && (data.city === city || !data.city)) {
    return { city: data.city, stores: data.stores, items: data.items }
  }
  return null
}

const PRICES_URL = 'https://raw.githubusercontent.com/ofekSro/kniot/data/prices.json'

/**
 * Fetch the price snapshot. Returns null on any failure or an unrecognized
 * shape (e.g. an older snapshot) so callers can show an empty state instead of
 * crashing. `bust` bypasses the ~5-minute raw.githubusercontent cache.
 */
export async function fetchPriceData(bust = false): Promise<PriceData | null> {
  try {
    const url = bust ? `${PRICES_URL}?t=${Date.now()}` : PRICES_URL
    const res = await fetch(url, { cache: bust ? 'no-store' : 'default' })
    if (!res.ok) return null
    const data = (await res.json()) as PriceData | null
    if (!data || typeof data !== 'object') return null
    const hasSingle = Array.isArray(data.stores) && Array.isArray(data.items)
    const hasMulti = data.byCity && typeof data.byCity === 'object'
    if (!hasSingle && !hasMulti) return null
    return data
  } catch {
    return null
  }
}

export interface StoreRank {
  store: PriceStore
  /** Sum of unit price × quantity over the basket items this store carries. */
  total: number
  /** How many of the priced basket items this store stocks. */
  covered: number
  /** List names of priced basket items this store is missing. */
  missing: string[]
}

export interface ItemBreakdown {
  key: string
  /** The name as it appears in the user's list. */
  name: string
  /** The canonical product that was priced, when available. */
  product?: string
  /** Quantity multiplier applied (parsed from the list item's qty). */
  qty: number
  /** True when at least one store has a price for it. */
  priced: boolean
  cheapest?: { store: PriceStore; price: number }
  byStore?: Record<string, number>
}

export interface Ranking {
  city?: string
  updatedAt?: string
  stores: StoreRank[]
  items: ItemBreakdown[]
  /** Number of active list items considered. */
  basketCount: number
  /** How many of them had any price data. */
  pricedCount: number
}

/** A leading whole number in a free-text qty ("2", "3 יח'") is a multiplier. */
function qtyMultiplier(qty: string | null | undefined): number {
  if (!qty) return 1
  const m = qty.trim().match(/^(\d{1,2})(?!\d)/)
  const n = m ? Number.parseInt(m[1], 10) : 1
  return n > 0 && n <= 99 ? n : 1
}

/**
 * Rank the stores for the current basket. Sort **coverage first, then total**:
 * a store that stocks few of the basket's items would otherwise show a low
 * total and look cheapest when it simply carries less. Items with no price data
 * (not yet fetched) are excluded from every store's total and coverage.
 */
export function rankBasket(
  active: readonly { name: string; qty: string | null }[],
  slice: PriceSlice | null,
): Ranking {
  if (!slice) {
    return { stores: [], items: [], basketCount: active.length, pricedCount: 0 }
  }

  const itemByKey = new Map(slice.items.map((it) => [it.k, it]))
  const storeByKey = new Map(slice.stores.map((s) => [s.key, s]))

  const basket = active.map((a) => {
    const key = nameKeyOf(a.name)
    return { a, key, priced: itemByKey.get(key), mult: qtyMultiplier(a.qty) }
  })
  const pricedBasket = basket.filter(
    (b) => b.priced && Object.keys(b.priced.byStore).length > 0,
  )

  const stores: StoreRank[] = slice.stores
    .map((store) => {
      let total = 0
      let covered = 0
      const missing: string[] = []
      for (const b of pricedBasket) {
        const price = b.priced!.byStore[store.key]
        if (price != null) {
          total += price * b.mult
          covered++
        } else {
          missing.push(b.a.name)
        }
      }
      return { store, total, covered, missing }
    })
    .filter((r) => r.covered > 0)
    .sort((x, y) => y.covered - x.covered || x.total - y.total)

  const items: ItemBreakdown[] = basket.map((b) => {
    if (!b.priced || Object.keys(b.priced.byStore).length === 0) {
      return { key: b.key, name: b.a.name, qty: b.mult, priced: false }
    }
    let cheapest: { store: PriceStore; price: number } | undefined
    for (const [sk, price] of Object.entries(b.priced.byStore)) {
      const st = storeByKey.get(sk)
      if (!st) continue
      if (!cheapest || price < cheapest.price) cheapest = { store: st, price }
    }
    return {
      key: b.key,
      name: b.a.name,
      product: b.priced.product,
      qty: b.mult,
      priced: !!cheapest,
      cheapest,
      byStore: b.priced.byStore,
    }
  })

  return {
    city: slice.city,
    stores,
    items,
    basketCount: active.length,
    pricedCount: pricedBasket.length,
  }
}
