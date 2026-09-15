import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Rendered pinned at the bottom, below the scrolling body. */
  footer?: ReactNode
}

/**
 * Shared bottom-sheet shell: backdrop, slide-up panel, Esc + backdrop close,
 * body scroll lock. Used by the edit, favorites and settings sheets.
 */
export function Sheet({ open, onClose, title, children, footer }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="סגירה"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_150ms_ease-out] bg-black/40 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl motion-safe:animate-[sheet-up_220ms_cubic-bezier(0.32,0.72,0,1)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 pt-3 pb-3">
          <div className="flex flex-1 flex-col items-center gap-2">
            <div className="h-1 w-10 rounded-full bg-edge-strong" />
            <h2 className="text-base font-bold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="absolute end-3 top-4 flex size-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-track"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

        {footer && (
          <div className="safe-bottom shrink-0 border-t border-edge px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
