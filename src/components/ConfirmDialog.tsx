interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="ביטול"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-2xl bg-card p-5 shadow-2xl"
      >
        <h2 className="mb-1.5 text-lg font-bold">{title}</h2>
        <p className="mb-5 text-sm text-ink-muted">{body}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-xl bg-accent px-4 font-bold text-on-accent transition active:scale-[0.98]"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-xl bg-track px-5 font-medium transition active:scale-[0.98]"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
