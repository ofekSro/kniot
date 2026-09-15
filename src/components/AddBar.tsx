import { useMemo, useRef, useState } from 'react'
import { getCategory, guessCategory, nameKeyOf } from '../lib/categories'
import type { Favorite, HistoryEntry, Suggestion } from '../types'

interface Props {
  history: readonly HistoryEntry[]
  favorites: readonly Favorite[]
  onAdd: (draft: {
    name: string
    category: string
    /** From history when known; the caller derives from category when null. */
    store: string | null
    qty: string | null
  }) => Promise<void>
  onOpenFavorites: () => void
}

const MAX_SUGGESTIONS = 6

export function AddBar({ history, favorites, onAdd, onOpenFavorites }: Props) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Favorites first, then history by how often it was bought. Prefix match on
   * the normalised name, deduped so a product that is both a favorite and in
   * history appears once.
   */
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = nameKeyOf(query)
    if (!q) return []

    const seen = new Set<string>()
    const out: Suggestion[] = []

    for (const f of favorites) {
      if (f.id.startsWith(q) && !seen.has(f.id)) {
        seen.add(f.id)
        out.push({
          nameKey: f.id,
          name: f.name,
          category: f.category,
          store: null,
          qty: f.qty,
          isFavorite: true,
        })
      }
    }

    const ranked = [...history].sort((a, b) => b.count - a.count)
    for (const h of ranked) {
      if (out.length >= MAX_SUGGESTIONS) break
      if (h.id.startsWith(q) && !seen.has(h.id)) {
        seen.add(h.id)
        out.push({
          nameKey: h.id,
          name: h.name,
          category: h.category,
          store: h.store,
          qty: h.lastQty,
          isFavorite: false,
        })
      }
    }

    return out.slice(0, MAX_SUGGESTIONS)
  }, [query, history, favorites])

  const historyByKey = useMemo(
    () => new Map(history.map((h) => [h.id, h])),
    [history],
  )

  /** A typed name reuses its history entry; otherwise the keyword guesser runs. */
  async function submitTyped() {
    const name = query.trim()
    if (!name) return
    const known = historyByKey.get(nameKeyOf(name))
    setQuery('')
    await onAdd({
      name,
      category: known?.category ?? guessCategory(name),
      store: known?.store ?? null,
      qty: known?.lastQty ?? null,
    })
  }

  async function submitSuggestion(s: Suggestion) {
    setQuery('')
    inputRef.current?.focus()
    await onAdd({ name: s.name, category: s.category, store: s.store, qty: s.qty })
  }

  const showSuggestions = focused && suggestions.length > 0

  return (
    <div className="safe-top sticky top-0 z-30 border-b border-edge bg-app-bg/95 backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            void submitTyped()
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            // Delayed so a tap on a suggestion registers before the list unmounts.
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            placeholder="הוסף מוצר…"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            aria-label="הוסף מוצר"
            className="min-h-12 w-full rounded-2xl border border-edge-strong bg-field px-4 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />

          {showSuggestions && (
            <ul className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-2xl border border-edge bg-card shadow-xl">
              {suggestions.map((s) => {
                const cat = getCategory(s.category)
                return (
                  <li key={s.nameKey}>
                    <button
                      type="button"
                      // onMouseDown beats the input's blur, so the tap always lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void submitSuggestion(s)}
                      className="flex min-h-12 w-full items-center gap-2.5 px-4 text-start transition active:bg-track"
                    >
                      <span aria-hidden>{s.isFavorite ? '⭐' : cat.emoji}</span>
                      <span className="flex-1 font-medium">{s.name}</span>
                      {s.qty && (
                        <span className="text-xs text-ink-faint">{s.qty}</span>
                      )}
                      <span className="text-xs text-ink-faint">
                        {cat.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </form>

        <button
          type="button"
          onClick={onOpenFavorites}
          aria-label="מועדפים"
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-edge-strong bg-card text-xl transition active:scale-95"
        >
          <span aria-hidden>⭐</span>
        </button>
      </div>
    </div>
  )
}
