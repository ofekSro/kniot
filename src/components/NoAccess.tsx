interface Props {
  email: string | null
  onSignOut: () => void
}

export function NoAccess({ email, onSignOut }: Props) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-6xl" aria-hidden>
        🔒
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">אין לך גישה</h1>
        <p className="max-w-xs text-ink-muted">
          הרשימה הזו פרטית. אם זו טעות, התחברו עם החשבון הנכון.
        </p>
        {email && (
          <p className="mt-1 text-sm text-ink-faint" dir="ltr">
            {email}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="min-h-12 rounded-2xl bg-accent px-6 py-3 font-medium text-on-accent transition active:scale-[0.98]"
      >
        התנתקות
      </button>
    </div>
  )
}
