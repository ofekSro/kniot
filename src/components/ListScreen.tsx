import { useCallback, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { CATEGORIES } from '../lib/categories'
import { STORES, isStoreId, storeForCategory } from '../lib/stores'
import { useItems } from '../hooks/useItems'
import { useHistory } from '../hooks/useHistory'
import { useFavorites } from '../hooks/useFavorites'
import { useOnline } from '../hooks/useOnline'
import { useAppTitle } from '../hooks/useAppTitle'
import { AddBar } from './AddBar'
import { EditableTitle } from './EditableTitle'
import { CategoryGroup } from './CategoryGroup'
import { StoreSection } from './StoreSection'
import { BoughtSection } from './BoughtSection'
import { EditSheet } from './EditSheet'
import { FavoritesSheet } from './FavoritesSheet'
import { Settings } from './Settings'
import { OfflineBanner } from './OfflineBanner'
import { ConfirmDialog } from './ConfirmDialog'
import type { Favorite, Item } from '../types'

interface Props {
  user: User | null
  onSignOut: () => void
}

export function ListScreen({ user, onSignOut }: Props) {
  const online = useOnline()
  const { title, rename } = useAppTitle()
  const { entries: history } = useHistory()
  const {
    favorites,
    isFavorite,
    toggleFavorite,
    removeFavorite,
    renameFavorite,
  } = useFavorites()
  const {
    active,
    bought,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
    setBought,
    finishShopping,
  } = useItems()

  const [splitByStore, setSplitByStore] = useState(() => {
    try {
      return localStorage.getItem('splitByStore') === '1'
    } catch {
      return false
    }
  })
  const toggleSplit = useCallback(() => {
    setSplitByStore((v) => {
      try {
        localStorage.setItem('splitByStore', v ? '0' : '1')
      } catch {
        // Blocked storage: the toggle still works for this session.
      }
      return !v
    })
  }, [])

  const [editing, setEditing] = useState<Item | null>(null)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimer = useRef<number | undefined>(undefined)

  /** Flashes an existing row instead of adding a second copy of the same product. */
  const flash = useCallback((id: string) => {
    window.clearTimeout(highlightTimer.current)
    setHighlightedId(id)
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 1300)
  }, [])

  const handleAdd = useCallback(
    async (draft: {
      name: string
      category: string
      store: string | null
      qty: string | null
    }) => {
      const result = await addItem({
        ...draft,
        // A store remembered in history wins over the category default.
        store: isStoreId(draft.store) ? draft.store : storeForCategory(draft.category),
        note: null,
      })
      if (result.kind === 'duplicate') flash(result.id)
    },
    [addItem, flash],
  )

  const historyByKey = useMemo(
    () => new Map(history.map((h) => [h.id, h])),
    [history],
  )

  const storeForFavorite = useCallback(
    (fav: Favorite) => {
      const remembered = historyByKey.get(fav.id)?.store
      return isStoreId(remembered) ? remembered : storeForCategory(fav.category)
    },
    [historyByKey],
  )

  const addFavoriteToList = useCallback(
    async (fav: Favorite) => {
      const result = await addItem({
        name: fav.name,
        category: fav.category,
        store: storeForFavorite(fav),
        qty: fav.qty,
        note: null,
      })
      if (result.kind === 'duplicate') flash(result.id)
    },
    [addItem, flash, storeForFavorite],
  )

  const addAllFavorites = useCallback(
    async (favs: readonly Favorite[]) => {
      for (const fav of favs) {
        await addItem({
          name: fav.name,
          category: fav.category,
          store: storeForFavorite(fav),
          qty: fav.qty,
          note: null,
        })
      }
    },
    [addItem, storeForFavorite],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of active) {
      const list = map.get(item.category)
      if (list) list.push(item)
      else map.set(item.category, [item])
    }
    return map
  }, [active])

  // A category id from an older document that is no longer in CATEGORIES still
  // renders, after the known ones, so nothing can silently disappear.
  const orderedCategoryIds = useMemo(() => {
    const known = CATEGORIES.map((c) => c.id) as string[]
    const extra = [...grouped.keys()].filter((id) => !known.includes(id))
    return [...known, ...extra]
  }, [grouped])

  const byStore = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of active) {
      const list = map.get(item.store)
      if (list) list.push(item)
      else map.set(item.store, [item])
    }
    return map
  }, [active])

  const isEmpty = active.length === 0 && bought.length === 0

  return (
    <div className="min-h-dvh">
      <OfflineBanner online={online} />

      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
        <EditableTitle title={title} onRename={(next) => void rename(next)} />
        <button
          type="button"
          onClick={toggleSplit}
          aria-pressed={splitByStore}
          className={
            'flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition active:scale-95 ' +
            (splitByStore
              ? 'bg-accent text-on-accent'
              : 'bg-track text-ink-muted')
          }
        >
          <span aria-hidden>🏪</span>
          <span>לפי חנות</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="הגדרות"
          className="flex size-11 items-center justify-center rounded-full transition active:bg-track"
        >
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
              className="size-9 rounded-full bg-track"
            />
          ) : (
            <span className="text-xl" aria-hidden>
              ⚙️
            </span>
          )}
        </button>
      </header>

      <AddBar
        history={history}
        favorites={favorites}
        onAdd={handleAdd}
        onOpenFavorites={() => setFavoritesOpen(true)}
      />

      <main className="px-3 pb-40">
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            שגיאה בטעינת הרשימה: {error}
          </p>
        )}

        {loading && !error && <p className="mt-10 text-center text-ink-faint">טוען…</p>}

        {!loading && !error && isEmpty && (
          <div className="mt-20 flex flex-col items-center gap-4 text-center">
            <p className="text-xl font-medium">הרשימה ריקה 🎉</p>
            <button
              type="button"
              onClick={() => setFavoritesOpen(true)}
              className="min-h-12 rounded-2xl bg-accent px-5 font-medium text-on-accent transition active:scale-[0.98]"
            >
              הוספה מהמועדפים
            </button>
          </div>
        )}

        {splitByStore
          ? [...STORES.map((s) => s.id), ...[...byStore.keys()].filter(
              (id) => !STORES.some((s) => s.id === id),
            )].map((storeId) => (
              <StoreSection
                key={storeId}
                storeId={storeId}
                items={byStore.get(storeId) ?? []}
                highlightedId={highlightedId}
                onToggle={(itemId, next) => void setBought(itemId, next)}
                onOpen={setEditing}
              />
            ))
          : orderedCategoryIds.map((id) => (
              <CategoryGroup
                key={id}
                categoryId={id}
                items={grouped.get(id) ?? []}
                highlightedId={highlightedId}
                onToggle={(itemId, next) => void setBought(itemId, next)}
                onOpen={setEditing}
              />
            ))}

        <BoughtSection
          items={bought}
          onToggle={(itemId, next) => void setBought(itemId, next)}
          onOpen={setEditing}
        />
      </main>

      {bought.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-app-bg via-app-bg to-transparent px-4 pt-6 pb-3">
          <button
            type="button"
            onClick={() => setConfirmFinish(true)}
            className="mx-auto flex min-h-14 w-full max-w-lg items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-base font-bold text-on-accent shadow-lg transition active:scale-[0.98]"
          >
            סיימתי קנייה
            <span className="rounded-full bg-card/20 px-2 py-0.5 text-sm">
              {bought.length}
            </span>
          </button>
        </div>
      )}

      <EditSheet
        item={editing}
        isFavorite={editing ? isFavorite(editing.name) : false}
        onClose={() => setEditing(null)}
        onSave={updateItem}
        onDelete={deleteItem}
        onToggleFavorite={toggleFavorite}
      />

      <FavoritesSheet
        open={favoritesOpen}
        favorites={favorites}
        onClose={() => setFavoritesOpen(false)}
        onAdd={addFavoriteToList}
        onAddAll={addAllFavorites}
        onRename={renameFavorite}
        onRemove={removeFavorite}
      />

      <Settings
        open={settingsOpen}
        user={user}
        onClose={() => setSettingsOpen(false)}
        onSignOut={onSignOut}
      />

      <ConfirmDialog
        open={confirmFinish}
        title="לסיים את הקנייה?"
        body={`${bought.length} מוצרים יישמרו בהיסטוריה ויימחקו מהרשימה.`}
        confirmLabel="סיימתי"
        onConfirm={() => {
          setConfirmFinish(false)
          void finishShopping(bought)
        }}
        onCancel={() => setConfirmFinish(false)}
      />
    </div>
  )
}
