import type { CategoryId } from './categories'

export type StoreId = 'super' | 'stock' | 'hishuk'

export interface Store {
  id: StoreId
  label: string
  emoji: string
}

/** Fixed render order for the split view. */
export const STORES: readonly Store[] = [
  { id: 'super', label: 'סופר', emoji: '🛒' },
  { id: 'stock', label: 'סטוק', emoji: '🧽' },
  { id: 'hishuk', label: 'החישוק', emoji: '📦' },
] as const

export const DEFAULT_STORE: StoreId = 'super'

const STORE_BY_ID = new Map<string, Store>(STORES.map((s) => [s.id, s]))

const FALLBACK: Store = { id: 'super', label: 'סופר', emoji: '🛒' }

export function getStore(id: string): Store {
  return STORE_BY_ID.get(id) ?? FALLBACK
}

export function isStoreId(id: unknown): id is StoreId {
  return typeof id === 'string' && STORE_BY_ID.has(id)
}

/**
 * The household's shopping split: cleaning and toiletries come from the discount
 * store, dry goods from the online shop, everything else from the supermarket.
 * This is only the default — the edit sheet can override per item, and history
 * remembers the override from the second purchase onward.
 */
export function storeForCategory(categoryId: CategoryId | string): StoreId {
  switch (categoryId) {
    case 'cleaning':
    case 'toiletries':
      return 'stock'
    case 'pantry':
      return 'hishuk'
    default:
      return 'super'
  }
}
