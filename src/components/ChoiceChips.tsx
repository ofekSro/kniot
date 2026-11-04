import { useState } from 'react'
import { productKey, type CatalogChoice, type CatalogEntry } from '../lib/catalog'

interface Props {
  choices: readonly CatalogChoice[]
  /** productKey of the choice that is the current name, if any. */
  selected?: string | null
  /** Shown first: the way back to the wider name. */
  widen?: { label: string; entry: CatalogEntry } | null
  onPick: (entry: CatalogEntry) => void
}

const VISIBLE = 8

const chipClass = (on: boolean) =>
  'min-h-11 min-w-11 max-w-full truncate rounded-full border px-3.5 text-sm font-medium transition active:scale-95 ' +
  (on ? 'border-accent bg-accent text-on-accent' : 'border-edge-strong bg-card text-ink')

/**
 * The kinds of a product, as the chains' own names divide it. Shared by the add bar
 * and the edit sheet; onMouseDown keeps the add bar's input from blurring mid-tap.
 */
export function ChoiceChips({ choices, selected, widen, onPick }: Props) {
  const [showAll, setShowAll] = useState(false)
  const selectedAt = choices.findIndex((c) => productKey(c.entry.name) === selected)
  const limit = showAll || selectedAt >= VISIBLE ? choices.length : VISIBLE
  const hidden = choices.length - limit

  return (
    <div className="flex flex-wrap gap-2">
      {widen && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(widen.entry)}
          className={chipClass(false)}
        >
          {widen.label}
        </button>
      )}
      {choices.slice(0, limit).map((c, i) => (
        <button
          key={c.entry.name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c.entry)}
          aria-label={c.entry.name}
          aria-pressed={i === selectedAt}
          className={chipClass(i === selectedAt)}
        >
          {c.label}
        </button>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowAll(true)}
          className="min-h-11 rounded-full px-3 text-sm font-medium text-accent-ink transition active:scale-95"
        >
          עוד {hidden}
        </button>
      )}
    </div>
  )
}
