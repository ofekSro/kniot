import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/**
 * True only when every required value is present. Checked before rendering the
 * app so a fresh clone with no .env shows setup instructions instead of a login
 * button that fails with an opaque Firebase error.
 */
export const isFirebaseConfigured: boolean = Object.values(firebaseConfig).every(
  (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('your-') && v !== 'AIzaSy...',
)

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

export const provider = new GoogleAuthProvider()
// Always let the user pick which Google account — two people share one phone browser often.
provider.setCustomParameters({ prompt: 'select_account' })

// initializeFirestore (not getFirestore) is required to pass a cache config.
// The multi-tab manager keeps two open tabs from fighting over the IndexedDB lease.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
