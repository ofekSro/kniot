import type { CSSProperties } from 'react'
import { CATEGORY_HUES, getCategory, isCategoryId } from '../lib/categories'
import { ItemRow } from './ItemRow'
import type { Item } from '../types'

interface Props {
  categoryId: string
  items: readonly Item[]
  highlightedId: string | null
  onToggle: (id: string, next: boolean) => void
  onOpen: (item: Item) => void
}

export function CategoryGroup({
  categoryId,
  items,
  highlightedId,
  onToggle,
  onOpen,
}: Props) {
  if (items.length === 0) return null
  const category = getCategory(categoryId)
  // Skins that color-code categories derive their tints from this hue in CSS.
  const hue = CATEGORY_HUES[isCategoryId(categoryId) ? categoryId : 'other']

  return (
    <section
      className="mb-1"
      style={{ '--cat-hue': hue } as CSSProperties}
    >
      <h2 className="cat-title flex items-center gap-2 px-3 pt-4 pb-1 font-display text-sm font-bold text-ink-muted">
        <span aria-hidden>{category.emoji}</span>
        <span>{category.label}</span>
        <span className="text-xs font-normal text-ink-faint">
          {items.length}
        </span>
      </h2>
      <ul className="cat-card divide-y divide-edge rounded-2xl border border-transparent bg-card px-1 shadow-sm">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            highlighted={item.id === highlightedId}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  )
}
