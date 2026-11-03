import { useCallback, useRef, useState } from 'react'
import { fetchCatalog, type CatalogEntry } from '../lib/catalog'

/**
 * The nightly product catalog, loaded lazily the first time the add bar is
 * focused (it is ~1 MB, so it is not fetched on every app start). The service
 * worker keeps the last copy so suggestions also work offline.
 */
export function useCatalog() {
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([])
  const started = useRef(false)

  const ensure = useCallback(() => {
    if (started.current) return
    started.current = true
    void fetchCatalog().then((c) => {
      if (c) setEntries(c.entries)
      else started.current = false // allow a retry on the next focus
    })
  }, [])

  return { entries, ensure }
}
