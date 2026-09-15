import { useCallback, useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

export const DEFAULT_TITLE = 'רשימת קניות'
const MAX_LENGTH = 40

const settingsRef = doc(db, 'config', 'settings')

/**
 * The list's display title, shared between both phones via config/settings.
 * The document may not exist yet — the default title is used until someone
 * renames, and the first rename creates it.
 */
export function useAppTitle() {
  const [title, setTitle] = useState(DEFAULT_TITLE)

  useEffect(() => {
    return onSnapshot(
      settingsRef,
      (snap) => {
        const t = snap.data()?.title
        setTitle(typeof t === 'string' && t.trim() ? t.trim() : DEFAULT_TITLE)
      },
      () => {
        // Permission or network error: keep whatever title we already show.
      },
    )
  }, [])

  // Keep the browser-tab / task-switcher label in sync with the custom name.
  useEffect(() => {
    document.title = title
  }, [title])

  const rename = useCallback(async (next: string) => {
    const clean = next.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH)
    await setDoc(settingsRef, { title: clean || DEFAULT_TITLE }, { merge: true })
  }, [])

  return { title, rename }
}
