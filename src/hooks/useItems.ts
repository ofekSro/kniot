import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { categoryIndex, nameKeyOf } from '../lib/categories'
import { isStoreId, storeForCategory } from '../lib/stores'
import type { Item } from '../types'

export interface ItemDraft {
  name: string
  category: string
  store: string
  qty: string | null
  note: string | null
}

export type AddResult =
  | { kind: 'added'; id: string }
  | { kind: 'duplicate'; id: string }
  | { kind: 'empty' }

const itemsCol = collection(db, 'items')

/**
 * Timestamps use Timestamp.now() rather than serverTimestamp() on purpose:
 * serverTimestamp() reads back as null in local snapshots until the server
 * acknowledges the write, which makes rows jump around while offline — exactly
 * the supermarket case. The client clock is more than good enough for ordering
 * items inside a category.
 */
export function useItems() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onSnapshot(
      itemsCol,
      { includeMetadataChanges: false },
      (snap) => {
        const next = snap.docs.map((d) => {
          const data = d.data()
          const category = typeof data.category === 'string' ? data.category : 'other'
          return {
            id: d.id,
            name: typeof data.name === 'string' ? data.name : '',
            category,
            // Items created before the store feature have no store field;
            // deriving it here means no migration is ever needed.
            store: isStoreId(data.store) ? data.store : storeForCategory(category),
            qty: typeof data.qty === 'string' && data.qty ? data.qty : null,
            note: typeof data.note === 'string' && data.note ? data.note : null,
            bought: data.bought === true,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
            boughtAt: data.boughtAt instanceof Timestamp ? data.boughtAt : null,
          } satisfies Item
        })
        setItems(next)
        setLoading(false)
        setError(null)
      },
      (err) => {
        setLoading(false)
        setError(err.message)
      },
    )
    return unsub
  }, [])

  const active = useMemo(
    () => items.filter((i) => !i.bought).sort(byCategoryThenCreated),
    [items],
  )

  const bought = useMemo(
    () =>
      items
        .filter((i) => i.bought)
        // Most recently checked first — that is the one you'd undo.
        .sort((a, b) => millis(b.boughtAt) - millis(a.boughtAt)),
    [items],
  )

  const addItem = useCallback(
    async (draft: ItemDraft): Promise<AddResult> => {
      const name = draft.name.trim()
      if (!name) return { kind: 'empty' }

      const key = nameKeyOf(name)
      const existing = items.find((i) => !i.bought && nameKeyOf(i.name) === key)
      if (existing) return { kind: 'duplicate', id: existing.id }

      const ref = await addDoc(itemsCol, {
        name,
        category: draft.category,
        store: draft.store,
        qty: draft.qty,
        note: draft.note,
        bought: false,
        createdAt: Timestamp.now(),
        boughtAt: null,
      })
      return { kind: 'added', id: ref.id }
    },
    [items],
  )

  const updateItem = useCallback(async (id: string, patch: Partial<ItemDraft>) => {
    const data: Record<string, unknown> = { ...patch }
    if (typeof data.name === 'string') data.name = data.name.trim()
    await updateDoc(doc(db, 'items', id), data)
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'items', id))
  }, [])

  const setBought = useCallback(async (id: string, value: boolean) => {
    await updateDoc(doc(db, 'items', id), {
      bought: value,
      boughtAt: value ? Timestamp.now() : null,
    })
  }, [])

  /**
   * Records every bought item into history (count + 1, latest qty/category) and
   * removes it from the list. Batched so the whole purchase lands atomically,
   * and chunked because a batch caps at 500 operations and each item costs two.
   */
  const finishShopping = useCallback(async (toFinish: readonly Item[]) => {
    const CHUNK = 200
    const now = Timestamp.now()

    for (let i = 0; i < toFinish.length; i += CHUNK) {
      const batch = writeBatch(db)
      for (const item of toFinish.slice(i, i + CHUNK)) {
        const key = nameKeyOf(item.name)
        if (key) {
          batch.set(
            doc(db, 'history', key),
            {
              name: item.name.trim(),
              category: item.category,
              store: item.store,
              lastQty: item.qty,
              count: increment(1),
              lastUsedAt: now,
            },
            { merge: true },
          )
        }
        batch.delete(doc(db, 'items', item.id))
      }
      await batch.commit()
    }
  }, [])

  return {
    items,
    active,
    bought,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
    setBought,
    finishShopping,
  }
}

function millis(t: Item['createdAt']): number {
  return t ? t.toMillis() : 0
}

function byCategoryThenCreated(a: Item, b: Item): number {
  const byCat = categoryIndex(a.category) - categoryIndex(b.category)
  if (byCat !== 0) return byCat
  return millis(a.createdAt) - millis(b.createdAt)
}
