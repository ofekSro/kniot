import type { Timestamp } from 'firebase/firestore'
import type { CatalogChoice } from './lib/catalog'
import type { ProductLink } from './lib/prices'

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
  /** Set for catalog rows: the concrete product the name gets pinned to. */
  product?: ProductLink
  /** Short note beside a catalog row ("לפי משקל", "17 מוצרים"). */
  hint?: string
  /** The kinds to choose from under this name ("M", "L", "אומגה"). */
  choices?: readonly CatalogChoice[]
  /** The same name is already offered from history or favorites: only its kinds are new. */
  choicesOnly?: boolean
}
