import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, provider } from '../lib/firebase'

export type AuthStatus = 'loading' | 'signed-out' | 'no-access' | 'ready'

export interface AuthState {
  status: AuthStatus
  user: User | null
  error: string | null
}

/**
 * The whitelist lives in Firestore rules, not here. The client simply tries to
 * read config/allowedUsers:
 *   success          -> allowed
 *   permission-denied-> not on the list
 *   anything else    -> almost always offline on a cold cache; let the user in
 *                       and let the cache serve the list. A genuinely unauthorised
 *                       user still cannot read or write a single item.
 * This also means the email list is never shipped to a client that isn't on it.
 */
export function useAuth(): AuthState & {
  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
} {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    error: null,
  })

  useEffect(() => {
    // Guards against a slow whitelist check resolving after the user has already
    // signed out or switched accounts, which would otherwise restore the old one.
    let generation = 0
    let cancelled = false

    const unsub = onAuthStateChanged(auth, (user) => {
      const current = ++generation

      if (!user) {
        setState({ status: 'signed-out', user: null, error: null })
        return
      }

      setState({ status: 'loading', user, error: null })

      getDoc(doc(db, 'config', 'allowedUsers'))
        .then(() => {
          if (cancelled || current !== generation) return
          setState({ status: 'ready', user, error: null })
        })
        .catch((err: unknown) => {
          if (cancelled || current !== generation) return
          const denied =
            err instanceof FirebaseError && err.code === 'permission-denied'
          setState({ status: denied ? 'no-access' : 'ready', user, error: null })
        })
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  async function signIn() {
    setState((s) => ({ ...s, error: null }))
    try {
      await signInWithPopup(auth, provider)
    } catch (err: unknown) {
      if (err instanceof FirebaseError) {
        // Closing the Google popup is a normal action, not an error worth showing.
        if (
          err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request'
        ) {
          return
        }
        setState((s) => ({ ...s, error: describeAuthError(err.code) }))
        return
      }
      setState((s) => ({ ...s, error: 'ההתחברות נכשלה. נסו שוב.' }))
    }
  }

  async function signOutUser() {
    await signOut(auth)
  }

  return { ...state, signIn, signOutUser }
}

function describeAuthError(code: string): string {
  switch (code) {
    case 'auth/network-request-failed':
      return 'אין חיבור לאינטרנט. כדי להתחבר בפעם הראשונה צריך רשת.'
    case 'auth/unauthorized-domain':
      return 'הדומיין הזה לא מאושר בהגדרות Firebase Authentication.'
    case 'auth/popup-blocked':
      return 'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים ונסו שוב.'
    case 'auth/operation-not-allowed':
      return 'התחברות עם Google לא מופעלת בפרויקט Firebase.'
    default:
      return 'ההתחברות נכשלה. נסו שוב.'
  }
}
