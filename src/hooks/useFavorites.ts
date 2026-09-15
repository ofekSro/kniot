import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { nameKeyOf } from '../lib/categories'
import type { Favorite } from '../types'

const favoritesCol = collection(db, 'favorites')

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      favoritesCol,
      (snap) => {
        setFavorites(
          snap.docs
            .map((d) => {
              const data = d.data()
              return {
                id: d.id,
                name: typeof data.name === 'string' ? data.name : d.id,
                category: typeof data.category === 'string' ? data.category : 'other',
                qty: typeof data.qty === 'string' && data.qty ? data.qty : null,
              } satisfies Favorite
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'he')),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [])

  const keys = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])

  const isFavorite = useCallback((name: string) => keys.has(nameKeyOf(name)), [keys])

  const addFavorite = useCallback(
    async (fav: { name: string; category: string; qty: string | null }) => {
      const name = fav.name.trim()
      const key = nameKeyOf(name)
      if (!key) return
      await setDoc(doc(db, 'favorites', key), {
        name,
        category: fav.category,
        qty: fav.qty,
      })
    },
    [],
  )

  const removeFavorite = useCallback(async (name: string) => {
    const key = nameKeyOf(name)
    if (!key) return
    await deleteDoc(doc(db, 'favorites', key))
  }, [])

  const toggleFavorite = useCallback(
    async (fav: { name: string; category: string; qty: string | null }) => {
      if (keys.has(nameKeyOf(fav.name))) await removeFavorite(fav.name)
      else await addFavorite(fav)
    },
    [keys, addFavorite, removeFavorite],
  )

  /** Renaming changes the document id, so it is a create + delete, not an update. */
  const renameFavorite = useCallback(
    async (oldName: string, newName: string) => {
      const oldKey = nameKeyOf(oldName)
      const newKey = nameKeyOf(newName)
      if (!newKey || oldKey === newKey) return
      const current = favorites.find((f) => f.id === oldKey)
      if (!current) return
      await setDoc(doc(db, 'favorites', newKey), {
        name: newName.trim(),
        category: current.category,
        qty: current.qty,
      })
      await deleteDoc(doc(db, 'favorites', oldKey))
    },
    [favorites],
  )

  return {
    favorites,
    loading,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    renameFavorite,
  }
}
