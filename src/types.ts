import type { Timestamp } from 'firebase/firestore'

export interface Item {
  id: string
  name: string
  category: string
  /** StoreId; derived from the category when absent on old documents. */
  store: string
  qty: string | null
  note: string | null
  bought: boolean
  createdAt: Timestamp | null
  boughtAt: Timestamp | null
}

export interface HistoryEntry {
  /** Document id === nameKey. */
  id: string
  name: string
  category: string
  store: string | null
  lastQty: string | null
  count: number
  lastUsedAt: Timestamp | null
}

export interface Favorite {
  /** Document id === nameKey. */
  id: string
  name: string
  category: string
  qty: string | null
}

export interface Suggestion {
  nameKey: string
  name: string
  category: string
  store: string | null
  qty: string | null
  isFavorite: boolean
}
