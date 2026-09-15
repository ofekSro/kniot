import { useRef, useState } from 'react'

interface Props {
  title: string
  onRename: (next: string) => void
}

/**
 * The list title. Tapping it swaps in an input styled like the heading;
 * Enter or tapping elsewhere saves, Escape cancels. An empty name falls
 * back to the default (handled by the rename hook).
 */
export function EditableTitle({ title, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const cancelled = useRef(false)

  function start() {
    setDraft(title)
    cancelled.current = false
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (cancelled.current) return
    const next = draft.trim()
    if (next !== title) onRename(next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label="שינוי שם הרשימה"
        title="לחיצה לשינוי השם"
        className="-ms-1 flex min-h-11 min-w-0 flex-1 items-center rounded-lg px-1 text-start transition active:bg-track"
      >
        <h1 className="truncate font-display text-xl font-bold">{title}</h1>
      </button>
    )
  }

  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        commit()
      }}
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancelled.current = true
            setEditing(false)
          }
        }}
        maxLength={40}
        enterKeyHint="done"
        aria-label="שם הרשימה"
        className="min-h-11 w-full rounded-lg border border-accent bg-field px-1 font-display text-xl font-bold outline-none ring-2 ring-accent/20"
      />
    </form>
  )
}
