import { useMemo, useRef, useState } from 'react'
import { getCategory, guessCategory, nameKeyOf } from '../lib/categories'
import { linkOf, searchCatalog, type CatalogEntry } from '../lib/catalog'
import type { ProductLink } from '../lib/prices'
import type { Favorite, HistoryEntry, Suggestion } from '../types'

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
const MAX_CATALOG = 5

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

  /**
   * Concrete products from the chains' catalog, so the typed name gets pinned
   * to exactly what should be priced ("מלפפון" the vegetable, not the pickles).
   * Names already offered from favorites/history are skipped.
   */
  const catalogRows = useMemo<Suggestion[]>(() => {
    if (!query.trim()) return []
    const taken = new Set(suggestions.map((s) => s.nameKey))
    const out: Suggestion[] = []
    for (const e of searchCatalog(catalog, query, MAX_CATALOG + MAX_SUGGESTIONS)) {
      const key = nameKeyOf(e.name)
      if (taken.has(key)) continue
      taken.add(key)
      const known = historyByKey.get(key)
      out.push({
        nameKey: key,
        name: e.name,
        category: known?.category ?? guessCategory(e.name),
        store: known?.store ?? null,
        qty: known?.lastQty ?? null,
        isFavorite: false,
        product: linkOf(e),
        chains: e.chains,
      })
      if (out.length >= MAX_CATALOG) break
    }
    return out
  }, [query, catalog, suggestions, historyByKey])

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
                  מוצרים מהרשתות — בחירה מצמידה מחיר מדויק
                </li>
              )}
              {catalogRows.map((s) => (
                <li key={'cat:' + s.nameKey}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void submitSuggestion(s)}
                    className="flex min-h-12 w-full items-center gap-2.5 px-4 text-start transition active:bg-track"
                  >
                    <span aria-hidden>{s.product?.kind === 'weighed' ? '⚖️' : '🏷️'}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {s.product?.kind === 'weighed'
                        ? 'לפי משקל'
                        : s.chains && s.chains.length === 1
                          ? s.chains[0]
                          : `${s.chains?.length ?? 0} רשתות`}
                    </span>
                  </button>
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
