import { useCallback, useMemo, useRef, useState } from 'react'
import { getCategory, guessCategory, nameKeyOf } from '../lib/categories'
import {
  linkOf,
  nameMatches,
  productKey,
  searchCatalog,
  type CatalogEntry,
} from '../lib/catalog'
import type { ProductLink } from '../lib/prices'
import type { Favorite, HistoryEntry, Suggestion } from '../types'
import { ChoiceChips } from './ChoiceChips'

interface Props {
  history: readonly HistoryEntry[]
  favorites: readonly Favorite[]
  /** Nightly product catalog (empty until loaded — see onFocus). */
  catalog: readonly CatalogEntry[]
  /** Called on focus so the catalog is only fetched once the bar is used. */
  onFocus: () => void
  onAdd: (draft: {
    name: string
    category: string
    /** From history when known; the caller derives from category when null. */
    store: string | null
    qty: string | null
    /** A concrete product chosen from the catalog, to pin for pricing. */
    product?: ProductLink
  }) => Promise<void>
  onOpenFavorites: () => void
}

const MAX_SUGGESTIONS = 6
const MAX_CATALOG = 6

/** Favorite/history ids are exact keys; the typed text may be another spelling of them. */
const matches = (id: string, name: string, key: string, typed: string) =>
  id.startsWith(key) || nameMatches(name, typed)

export function AddBar({ history, favorites, catalog, onFocus, onAdd, onOpenFavorites }: Props) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const historyByKey = useMemo(
    () => new Map(history.map((h) => [h.id, h])),
    [history],
  )

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
      if (matches(f.id, f.name, q, query) && !seen.has(f.id)) {
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
      if (matches(h.id, h.name, q, query) && !seen.has(h.id)) {
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

  const suggestionOf = useCallback(
    (entry: CatalogEntry): Suggestion => {
      const key = nameKeyOf(entry.name)
      const known = historyByKey.get(key)
      return {
        nameKey: key,
        name: entry.name,
        category: known?.category ?? guessCategory(entry.name),
        store: known?.store ?? null,
        qty: known?.lastQty ?? null,
        isFavorite: false,
        product: linkOf(entry),
        hint: entry.weighed ? 'לפי משקל' : entry.count > 1 ? `${entry.count} מוצרים` : undefined,
      }
    },
    [historyByKey],
  )

  /**
   * Generic product names from the chains' files, one row per name. Picking one
   * pins it ("מלפפון" the vegetable, not the pickles), and the job then computes each
   * branch's price for it. Names already offered from favorites/history are skipped,
   * including under another spelling, but their kinds are still offered.
   */
  const catalogRows = useMemo<Suggestion[]>(() => {
    if (!query.trim()) return []
    const taken = new Set(suggestions.map((s) => productKey(s.name)))
    const out: Suggestion[] = []
    for (const { entry, choices } of searchCatalog(catalog, query, MAX_CATALOG + MAX_SUGGESTIONS)) {
      const same = productKey(entry.name)
      const repeated = taken.has(same)
      if (repeated && !choices?.length) continue
      taken.add(same)
      out.push({ ...suggestionOf(entry), choices, choicesOnly: repeated })
      if (out.length >= MAX_CATALOG) break
    }
    return out
  }, [query, catalog, suggestions, suggestionOf])

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
    await onAdd({
      name: s.name,
      category: s.category,
      store: s.store,
      qty: s.qty,
      product: s.product,
    })
  }

  const showSuggestions = focused && (suggestions.length > 0 || catalogRows.length > 0)

  return (
    <div className="safe-top sticky top-0 z-40 border-b border-edge bg-app-bg/95 backdrop-blur">
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
            onFocus={() => {
              setFocused(true)
              onFocus()
            }}
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
            <ul className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[60dvh] overflow-y-auto rounded-2xl border border-edge bg-card shadow-xl">
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

              {catalogRows.length > 0 && (
                <li
                  className={
                    'px-4 pt-2 pb-1 text-xs text-ink-faint ' +
                    (suggestions.length > 0 ? 'border-t border-edge' : '')
                  }
                >
                  מוצרים מהסופרים — המחיר יחושב בכל סופר
                </li>
              )}
              {catalogRows.map((s) => (
                <li key={'cat:' + s.nameKey}>
                  {!s.choicesOnly && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void submitSuggestion(s)}
                      aria-label={s.name}
                      className="flex min-h-12 w-full items-center gap-2.5 px-4 py-1 text-start transition active:bg-track"
                    >
                      <span aria-hidden>{s.product?.kind === 'weighed' ? '⚖️' : '🏷️'}</span>
                      <span className="line-clamp-2 min-w-0 flex-1 font-medium">{s.name}</span>
                      {s.hint && <span className="shrink-0 text-xs text-ink-faint">{s.hint}</span>}
                    </button>
                  )}
                  {!!s.choices?.length && (
                    <div className="flex flex-col gap-1.5 px-4 pt-1 pb-3">
                      <p className="text-xs text-ink-faint">
                        {s.choicesOnly ? `סוגים של ${s.name}:` : 'או סוג מסוים:'}
                      </p>
                      <ChoiceChips
                        key={s.nameKey}
                        choices={s.choices}
                        onPick={(entry) => void submitSuggestion(suggestionOf(entry))}
                      />
                    </div>
                  )}
                </li>
              ))}
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
