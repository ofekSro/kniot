import { useEffect } from 'react'
import { isFirebaseConfigured } from './lib/firebase'
import { applyTheme, getStoredTheme } from './lib/theme'
import { useAuth } from './hooks/useAuth'
import { Login } from './components/Login'
import { NoAccess } from './components/NoAccess'
import { ListScreen } from './components/ListScreen'
import { SetupNotice } from './components/SetupNotice'

export default function App() {
  const { status, user, error, signIn, signOutUser } = useAuth()

  // In "system" mode the OS theme can change while the app is open. This lives
  // here rather than in the settings sheet so it keeps working once that closes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (!isFirebaseConfigured) return <SetupNotice />

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div
          role="status"
          aria-label="טוען"
          className="size-8 animate-spin rounded-full border-4 border-edge-strong border-t-accent"
        />
      </div>
    )
  }

  if (status === 'signed-out') {
    return <Login onSignIn={() => void signIn()} error={error} />
  }

  if (status === 'no-access') {
    return <NoAccess email={user?.email ?? null} onSignOut={() => void signOutUser()} />
  }

  return <ListScreen user={user} onSignOut={() => void signOutUser()} />
}
