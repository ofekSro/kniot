import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Timestamp, arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { nameKeyOf } from '../lib/categories'
import { availableCities, fetchPriceData, type PriceData } from '../lib/prices'

const trackedRef = doc(db, 'config', 'trackedProducts')
const CITY_KEY = 'priceCity'
const DEFAULT_CITY = 'חיפה'

function storedCity(): string {
  try {
    return localStorage.getItem(CITY_KEY) || DEFAULT_CITY
  } catch {
    return DEFAULT_CITY
  }
}

/**
 * Owns everything price-related:
 *  - fetches the nightly snapshot from the data branch (with a manual refresh),
 *  - keeps config/trackedProducts in sync with the current list, so the nightly
 *    job knows which products to price (barcodes are resolved job-side),
 *  - tracks which city the ranking is shown for, and which cities to fetch,
 *  - lets the user pin a specific product for a name (overrides the auto-pick).
 *
 * config/trackedProducts is publicly readable (the job has no login); only
 * allowed users write it. `products`, `pins` and `cities` are merge-written as
 * separate fields so a change to one never clobbers the others.
 */
export function usePrices(active: readonly { name: string }[]) {
  const [data, setData] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [city, setCityState] = useState(storedCity)

  useEffect(() => {
    let alive = true
    void fetchPriceData().then((d) => {
      if (!alive) return
      setData(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const cities = useMemo(() => availableCities(data), [data])

  // If the remembered city isn't in the snapshot, fall back to the first one.
  useEffect(() => {
    if (cities.length && !cities.includes(city)) setCityState(cities[0])
  }, [cities, city])

  const setCity = useCallback((next: string) => {
    setCityState(next)
    try {
      localStorage.setItem(CITY_KEY, next)
    } catch {
      // Per-device preference only; ignore storage failures.
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const d = await fetchPriceData(true)
    setRefreshing(false)
    if (d) setData(d)
    return d
  }, [])

  // De-duplicated {k,n} list of the current active items.
  const products = useMemo(() => {
    const map = new Map<string, { k: string; n: string }>()
    for (const a of active) {
      const k = nameKeyOf(a.name)
      if (!map.has(k)) map.set(k, { k, n: a.name })
    }
    return [...map.values()]
  }, [active])

  // Push the list to Firestore for the nightly job, debounced, only on change.
  const lastSig = useRef<string | null>(null)
  useEffect(() => {
    const sig = products.map((p) => p.k).sort().join('|')
    if (sig === lastSig.current) return
    const id = window.setTimeout(() => {
      lastSig.current = sig
      void setDoc(
        trackedRef,
        { products, updatedAt: Timestamp.now() },
        { merge: true },
      ).catch(() => {
        // Offline or denied: the job keeps the previous list.
      })
    }, 3000)
    return () => window.clearTimeout(id)
  }, [products])

  const pinProduct = useCallback(async (key: string, barcode: string) => {
    await setDoc(trackedRef, { pins: { [key]: barcode } }, { merge: true })
  }, [])

  // Add/remove a city the nightly job should fetch (takes effect next run —
  // the added city only appears in the switcher once it has data).
  const addCity = useCallback(async (name: string) => {
    await setDoc(trackedRef, { cities: arrayUnion(name) }, { merge: true })
  }, [])
  const removeCity = useCallback(async (name: string) => {
    await setDoc(trackedRef, { cities: arrayRemove(name) }, { merge: true })
  }, [])

  return {
    data,
    loading,
    refreshing,
    refresh,
    city,
    cities,
    setCity,
    addCity,
    removeCity,
    pinProduct,
  }
}
