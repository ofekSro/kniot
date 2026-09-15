import { useState } from 'react'
import { CATEGORIES } from '../lib/categories'
import { getStore } from '../lib/stores'
import { CategoryGroup } from './CategoryGroup'
import type { Item } from '../types'

interface Props {
  storeId: string
  /** Active (unbought) items already filtered to this store. */
  items: readonly Item[]
  highlightedId: string | null
  onToggle: (id: string, next: boolean) => void
  onOpen: (item: Item) => void
}

/**
 * One store's slice of the split view: a store header with a share button,
 * and the usual category groups inside — same walking-route order as the
 * unified list.
 */
export function StoreSection({
  storeId,
  items,
  highlightedId,
  onToggle,
  onOpen,
}: Props) {
  const [copied, setCopied] = useState(false)
  if (items.length === 0) return null
  const store = getStore(storeId)

  const grouped = new Map<string, Item[]>()
  for (const item of items) {
    const list = grouped.get(item.category)
    if (list) list.push(item)
    else grouped.set(item.category, [item])
  }
  const known = CATEGORIES.map((c) => c.id) as string[]
  const orderedIds = [...known, ...[...grouped.keys()].filter((id) => !known.includes(id))]

  /**
   * Sharing exists mainly for החישוק: paste the list into the website instead
   * of retyping it. navigator.share on phones, clipboard on desktop.
   */
  async function share() {
    const lines = items.map((i) => {
      let line = `• ${i.name}`
      if (i.qty) line += ` — ${i.qty}`
      if (i.note) line += ` (${i.note})`
      return line
    })
    const text = `${store.label}:\n${lines.join('\n')}`

    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch {
      // User dismissed the share sheet — nothing to do.
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the button simply does nothing rather than erroring.
    }
  }

  return (
    <section className="mt-5 first:mt-1">
      <div className="flex items-center gap-2 rounded-2xl bg-band px-3 py-2">
        <span className="text-lg" aria-hidden>
          {store.emoji}
        </span>
        <h2 className="flex-1 font-display text-base font-bold">{store.label}</h2>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-ink-muted">
          {items.length}
        </span>
        <button
          type="button"
          onClick={() => void share()}
          aria-label={`שיתוף רשימת ${store.label}`}
          className="flex min-h-9 items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-ink-muted transition active:scale-95"
        >
          {copied ? (
            <span>הועתק ✓</span>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              <span>שיתוף</span>
            </>
          )}
        </button>
      </div>

      {orderedIds.map((id) => (
        <CategoryGroup
          key={id}
          categoryId={id}
          items={grouped.get(id) ?? []}
          highlightedId={highlightedId}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
    </section>
  )
}
