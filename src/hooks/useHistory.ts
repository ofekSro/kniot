import { useEffect, useMemo, useState } from 'react'
import { Timestamp, collection, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { HistoryEntry } from '../types'

const historyCol = collection(db, 'history')

/**
 * Purchase history, used to pre-fill category and quantity and to power
 * suggestions. Written by finishShopping() in useItems, read here.
 */
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      historyCol,
      (snap) => {
        setEntries(
          snap.docs.map((d) => {
            const data = d.data()
            return {
              id: d.id,
              name: typeof data.name === 'string' ? data.name : d.id,
              category: typeof data.category === 'string' ? data.category : 'other',
              store: typeof data.store === 'string' ? data.store : null,
              lastQty:
                typeof data.lastQty === 'string' && data.lastQty ? data.lastQty : null,
              count: typeof data.count === 'number' ? data.count : 0,
              lastUsedAt:
                data.lastUsedAt instanceof Timestamp ? data.lastUsedAt : null,
            } satisfies HistoryEntry
          }),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [])

  const byKey = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  )

  return { entries, byKey, loading }
}
