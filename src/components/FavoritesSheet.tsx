import { useState } from 'react'
import { getCategory } from '../lib/categories'
import { Sheet } from './Sheet'
import type { Favorite } from '../types'

interface Props {
  open: boolean
  favorites: readonly Favorite[]
  onClose: () => void
  onAdd: (fav: Favorite) => Promise<void>
  onAddAll: (favs: readonly Favorite[]) => Promise<void>
  onRename: (oldName: string, newName: string) => Promise<void>
  onRemove: (name: string) => Promise<void>
}

export function FavoritesSheet({
  open,
  favorites,
  onClose,
  onAdd,
  onAddAll,
  onRename,
  onRemove,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [added, setAdded] = useState<Set<string>>(new Set())

  function markAdded(id: string) {
    setAdded((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
      setAdded((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 1200)
  }

  function close() {
    setEditingId(null)
    setAdded(new Set())
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="מועדפים"
      footer={
        favorites.length > 0 ? (
          <button
            type="button"
            onClick={() => void onAddAll(favorites).then(close)}
            className="min-h-12 w-full rounded-xl bg-accent px-4 font-bold text-on-accent transition active:scale-[0.98]"
          >
            הוסף הכל
          </button>
        ) : undefined
      }
    >
      {favorites.length === 0 ? (
        <p className="py-10 text-center text-ink-muted">
          אין מועדפים עדיין.
          <br />
          אפשר לסמן מוצר בכוכב דרך עריכת מוצר.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {favorites.map((fav) => {
            const cat = getCategory(fav.category)
            const isEditing = editingId === fav.id

            return (
              <li
                key={fav.id}
                className="flex items-center gap-1 rounded-xl border border-edge px-2"
              >
                {isEditing ? (
                  <form
                    className="flex flex-1 items-center gap-2 py-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const next = draftName.trim()
                      setEditingId(null)
                      if (next && next !== fav.name) void onRename(fav.name, next)
                    }}
                  >
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="min-h-10 flex-1 rounded-lg border border-edge-strong bg-field px-2 text-base outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      className="min-h-10 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent"
                    >
                      שמירה
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(fav.id)
                        setDraftName(fav.name)
                      }}
                      className="flex min-h-12 flex-1 items-center gap-2 text-start"
                    >
                      <span aria-hidden>{cat.emoji}</span>
                      <span className="font-medium">{fav.name}</span>
                      {fav.qty && (
                        <span className="text-xs text-ink-faint">{fav.qty}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      aria-label={`מחיקת ${fav.name} מהמועדפים`}
                      onClick={() => void onRemove(fav.name)}
                      className="flex size-11 items-center justify-center rounded-lg text-ink-faint transition active:bg-track"
                    >
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      aria-label={`הוספת ${fav.name} לרשימה`}
                      onClick={() => void onAdd(fav).then(() => markAdded(fav.id))}
                      className={
                        'flex size-11 items-center justify-center rounded-lg text-xl font-bold transition active:scale-95 ' +
                        (added.has(fav.id)
                          ? 'bg-accent text-on-accent'
                          : 'bg-accent-soft text-accent-ink')
                      }
                    >
                      <span aria-hidden>{added.has(fav.id) ? '✓' : '+'}</span>
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
