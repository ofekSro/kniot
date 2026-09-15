import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Timestamp, doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { nameKeyOf } from '../lib/categories'
import { fetchPriceData, type PriceData } from '../lib/prices'

const trackedRef = doc(db, 'config', 'trackedProducts')

/**
 * Owns everything price-related:
 *  - fetches the nightly snapshot from the data branch (with a manual refresh),
 *  - keeps config/trackedProducts in sync with the current list, so the nightly
 *    job knows which products to price (barcodes are resolved job-side),
 *  - lets the user pin a specific product for a name (overrides the auto-pick).
 *
 * config/trackedProducts is publicly readable (the job has no login); only
 * allowed users write it. `products` is the current list; `pins` is a separate
 * map that survives list changes because we merge-write the two fields apart.
 */
export function usePrices(active: readonly { name: string }[]) {
  const [data, setData] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

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

  // Push the list to Firestore for the nightly job, debounced, and only when
  // the set of products actually changed.
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
        // Offline or denied: the job simply keeps the previous list.
      })
    }, 3000)
    return () => window.clearTimeout(id)
  }, [products])

  const pinProduct = useCallback(async (key: string, barcode: string) => {
    await setDoc(trackedRef, { pins: { [key]: barcode } }, { merge: true })
  }, [])

  return { data, loading, refreshing, refresh, pinProduct }
}
