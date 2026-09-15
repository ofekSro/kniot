interface Props {
  online: boolean
}

export function OfflineBanner({ online }: Props) {
  if (online) return null
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span aria-hidden>☁️</span>
      <span>לא מחובר – השינויים יסונכרנו</span>
    </div>
  )
}
