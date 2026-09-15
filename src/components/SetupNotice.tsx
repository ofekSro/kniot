/**
 * Shown when .env is missing or still holds the placeholder values from
 * .env.example. Mirrors the first steps of the README.
 */
export function SetupNotice() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 py-10">
      <div className="text-5xl" aria-hidden>
        🛠️
      </div>
      <h1 className="text-2xl font-bold">צריך להשלים הגדרה</h1>
      <p className="max-w-sm text-center text-ink-muted">
        חסרים פרטי החיבור ל‑Firebase. העתיקו את <Code>.env.example</Code> אל{' '}
        <Code>.env</Code> ומלאו את הערכים מ‑Firebase Console.
      </p>

      <ol className="flex w-full max-w-sm list-decimal flex-col gap-2 rounded-2xl bg-card p-5 ps-9 text-sm shadow-sm">
        <li>
          יצירת פרויקט ב‑<span dir="ltr">console.firebase.google.com</span>
        </li>
        <li>הוספת אפליקציית Web והעתקת ה‑config</li>
        <li>
          הפעלת Google ב‑<span dir="ltr">Authentication</span>
        </li>
        <li>
          <Code>npm run seed</Code> כדי לאשר את המשתמשים
        </li>
        <li>הרצה מחדש של שרת הפיתוח</li>
      </ol>

      <p className="text-center text-xs text-ink-faint">
        ההוראות המלאות נמצאות ב‑README.md
      </p>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      dir="ltr"
      className="rounded bg-track px-1.5 py-0.5 font-mono text-xs text-ink"
    >
      {children}
    </code>
  )
}
