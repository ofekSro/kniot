import { useState } from 'react'
import type { User } from 'firebase/auth'
import { THEME_LABELS, getStoredTheme, setStoredTheme } from '../lib/theme'
import type { ThemeMode } from '../lib/theme'
import { SKINS, getStoredSkin, setStoredSkin } from '../lib/skins'
import type { SkinId } from '../lib/skins'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  user: User | null
  onClose: () => void
  onSignOut: () => void
}

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

export function Settings({ open, user, onClose, onSignOut }: Props) {
  // Reads the stored value on each open; App owns reacting to OS theme changes.
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme)
  const [skin, setSkin] = useState<SkinId>(getStoredSkin)

  return (
    <Sheet open={open} onClose={onClose} title="הגדרות">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
              className="size-12 shrink-0 rounded-full bg-track"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-track text-lg">
              {user?.displayName?.[0] ?? '👤'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{user?.displayName ?? 'מחובר'}</p>
            <p
              className="truncate text-sm text-ink-muted"
              dir="ltr"
            >
              {user?.email}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink-muted">ערכת עיצוב</span>
          <div className="grid grid-cols-2 gap-2">
            {SKINS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={skin === s.id}
                onClick={() => {
                  setSkin(s.id)
                  setStoredSkin(s.id)
                }}
                className={
                  'flex min-h-14 items-center gap-3 rounded-xl border px-3 text-start transition active:scale-[0.98] ' +
                  (skin === s.id
                    ? 'border-accent ring-2 ring-accent/25'
                    : 'border-edge')
                }
              >
                <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                  {s.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block size-5 rounded-full border border-black/10"
                      style={{ backgroundColor: c, zIndex: 3 - i }}
                    />
                  ))}
                </span>
                <span className="text-sm font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink-muted">
            מראה
          </span>
          <div
            role="radiogroup"
            aria-label="מראה"
            className="flex gap-1 rounded-xl bg-track p-1"
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m)
                  setStoredTheme(m)
                }}
                className={
                  'min-h-11 flex-1 rounded-lg text-sm font-medium transition ' +
                  (mode === m
                    ? 'bg-card text-ink shadow-sm dark:text-ink'
                    : 'text-ink-muted')
                }
              >
                {THEME_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onSignOut}
          className="min-h-12 rounded-xl bg-track px-4 font-medium text-ink transition active:scale-[0.98] dark:text-ink"
        >
          התנתקות
        </button>

        <p className="text-center text-xs text-ink-faint">
          גרסה {__APP_VERSION__}
        </p>
      </div>
    </Sheet>
  )
}
