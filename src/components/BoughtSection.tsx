import { useState } from 'react'
import { ItemRow } from './ItemRow'
import type { Item } from '../types'

interface Props {
  items: readonly Item[]
  onToggle: (id: string, next: boolean) => void
  onOpen: (item: Item) => void
}

export function BoughtSection({ items, onToggle, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-sm font-bold text-ink-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className={'size-4 transition-transform ' + (open ? 'rotate-90' : '')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* Points into the text direction (RTL), so it reads as "expand". */}
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span>נקנו</span>
        <span className="rounded-full bg-track px-2 py-0.5 text-xs font-medium text-ink-muted">
          {items.length}
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-edge rounded-2xl bg-card px-1 opacity-80 shadow-sm">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              highlighted={false}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
