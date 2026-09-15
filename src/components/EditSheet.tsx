import { useEffect, useState } from 'react'
import { CATEGORIES } from '../lib/categories'
import { STORES, storeForCategory, isStoreId } from '../lib/stores'
import { Sheet } from './Sheet'
import type { Item } from '../types'
import type { ItemDraft } from '../hooks/useItems'

interface Props {
  item: Item | null
  isFavorite: boolean
  onClose: () => void
  onSave: (id: string, patch: Partial<ItemDraft>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggleFavorite: (fav: {
    name: string
    category: string
    qty: string | null
  }) => Promise<void>
}

const fieldClass =
  'min-h-12 w-full rounded-xl border border-edge-strong bg-card px-3 py-2.5 text-base text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 dark:text-ink'

export function EditSheet({
  item,
  isFavorite,
  onClose,
  onSave,
  onDelete,
  onToggleFavorite,
}: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('other')
  const [store, setStore] = useState('super')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Re-seed the form whenever a different item is opened.
  useEffect(() => {
    if (!item) return
    setName(item.name)
    setCategory(item.category)
    setStore(isStoreId(item.store) ? item.store : storeForCategory(item.category))
    setQty(item.qty ?? '')
    setNote(item.note ?? '')
    setConfirmDelete(false)
  }, [item])

  if (!item) return null
  const current = item

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    await onSave(current.id, {
      name: trimmed,
      category,
      store,
      qty: qty.trim() || null,
      note: note.trim() || null,
    })
    onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="עריכת מוצר"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            className="min-h-12 flex-1 rounded-xl bg-accent px-4 font-bold text-on-accent transition active:scale-[0.98] disabled:opacity-40"
            disabled={!name.trim()}
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              await onDelete(current.id)
              onClose()
            }}
            className={
              'min-h-12 rounded-xl px-4 font-medium transition active:scale-[0.98] ' +
              (confirmDelete
                ? 'bg-red-600 text-white'
                : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300')
            }
          >
            {confirmDelete ? 'בטוח? מחיקה' : 'מחיקה'}
          </button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="שם המוצר">
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <Field label="קטגוריה">
          <select
            className={fieldClass}
            value={category}
            onChange={(e) => {
              const next = e.target.value
              // If the store still matches the old category's default, follow the
              // new category; an explicit store override is left untouched.
              if (store === storeForCategory(category)) {
                setStore(storeForCategory(next))
              }
              setCategory(next)
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-muted">
            חנות
          </span>
          <div
            role="radiogroup"
            aria-label="חנות"
            className="flex gap-1 rounded-xl bg-track p-1"
          >
            {STORES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={store === s.id}
                onClick={() => setStore(s.id)}
                className={
                  'min-h-11 flex-1 rounded-lg text-sm font-medium transition ' +
                  (store === s.id
                    ? 'bg-card text-ink shadow-sm dark:text-ink'
                    : 'text-ink-muted')
                }
              >
                <span aria-hidden>{s.emoji}</span> {s.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="כמות">
          <input
            className={fieldClass}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder='למשל 2 או 1 ק"ג'
            autoComplete="off"
          />
        </Field>

        <Field label="הערה">
          <input
            className={fieldClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="למשל בלי סוכר"
            autoComplete="off"
          />
        </Field>

        <button
          type="button"
          onClick={() =>
            void onToggleFavorite({
              name: name.trim() || current.name,
              category,
              qty: qty.trim() || null,
            })
          }
          className="flex min-h-12 items-center gap-3 rounded-xl border border-edge px-3 text-start transition active:scale-[0.99]"
        >
          <span className="text-xl" aria-hidden>
            {isFavorite ? '⭐' : '☆'}
          </span>
          <span className="font-medium">
            {isFavorite ? 'במועדפים' : 'הוספה למועדפים'}
          </span>
        </button>

        {/* Lets Enter submit from any text field without a visible duplicate button. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
