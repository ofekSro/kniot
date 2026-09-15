import { useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { Barcode } from './Barcode'
import { CATEGORIES, getCategory, nameKeyOf } from '../lib/categories'
import { CITIES } from '../lib/cities'
import {
  cityData,
  rankBasket,
  type PriceData,
  type PriceStore,
  type PricedItem,
} from '../lib/prices'
import type { Item } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  active: readonly Item[]
  data: PriceData | null
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
  city: string
  cities: string[]
  onCityChange: (city: string) => void
  onAddCity: (city: string) => Promise<void>
}

const MEDALS = ['🥇', '🥈', '🥉']

function freshness(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'עודכן היום'
  if (days === 1) return 'עודכן אתמול'
  return `עודכן לפני ${days} ימים`
}

const shekel = (n: number) => '₪' + n.toFixed(2)

/** Active items in store-walking (category) order — for the in-store view. */
function inWalkOrder(active: readonly Item[]): Item[] {
  const order = new Map<string, number>(CATEGORIES.map((c, i) => [c.id, i]))
  return [...active].sort(
    (a, b) =>
      (order.get(a.category) ?? 999) - (order.get(b.category) ?? 999) ||
      a.name.localeCompare(b.name, 'he'),
  )
}

/**
 * "איפה הכי זול" — ranks the chosen city's branches for the current basket
 * (coverage first, then price), and, once you pick the branch you're standing
 * in ("אני בסופר"), shows the list with each product's barcode for scanning.
 * Prices are the nightly snapshot; the ranking is computed live from the list.
 */
export function PriceCheckSheet({
  open,
  onClose,
  active,
  data,
  loading,
  refreshing,
  onRefresh,
  city,
  cities,
  onCityChange,
  onAddCity,
}: Props) {
  const [showItems, setShowItems] = useState(false)
  const [store, setStore] = useState<PriceStore | null>(null)
  const [adding, setAdding] = useState(false)
  const [addedNote, setAddedNote] = useState<string | null>(null)

  const slice = useMemo(() => cityData(data, city), [data, city])
  const ranking = useMemo(
    () => rankBasket(active.map((a) => ({ name: a.name, qty: a.qty })), slice),
    [active, slice],
  )

  const itemByKey = useMemo(
    () => new Map((slice?.items ?? []).map((it) => [it.k, it])),
    [slice],
  )

  function close() {
    setStore(null)
    setAdding(false)
    onClose()
  }

  async function pickCity(name: string) {
    setAdding(false)
    if (cities.includes(name)) {
      onCityChange(name)
      return
    }
    await onAddCity(name)
    setAddedNote(name)
    window.setTimeout(() => setAddedNote(null), 4000)
  }

  const best = ranking.stores[0]
  const awaiting = ranking.items.filter((it) => !it.priced)
  const title = store ? `${store.chain} ${store.name}` : 'איפה הכי זול'

  return (
    <Sheet
      open={open}
      onClose={close}
      title={title}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-faint">נתוני chp.co.il + שקיפות מחירים</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="min-h-9 rounded-full bg-track px-3 text-sm font-medium text-ink-muted transition active:scale-95 disabled:opacity-50"
          >
            {refreshing ? 'מרענן…' : 'רענון'}
          </button>
        </div>
      }
    >
      {store ? (
        <StoreMode
          store={store}
          items={inWalkOrder(active)}
          itemByKey={itemByKey}
          onBack={() => setStore(null)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* City switcher */}
          <div className="flex flex-wrap items-center gap-1.5">
            {cities.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCityChange(c)}
                className={
                  'min-h-8 rounded-full px-3 text-sm font-medium transition active:scale-95 ' +
                  (c === city ? 'bg-accent text-on-accent' : 'bg-track text-ink-muted')
                }
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="min-h-8 rounded-full border border-edge px-3 text-sm font-medium text-ink-muted transition active:scale-95"
            >
              + עיר
            </button>
          </div>

          {adding && (
            <div className="rounded-xl border border-edge p-2">
              <p className="mb-2 px-1 text-xs text-ink-faint">
                בחרו עיר — היא תיכנס לבדיקה בעדכון הבא
              </p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {CITIES.filter((c) => !cities.includes(c)).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void pickCity(c)}
                    className="min-h-8 rounded-full bg-track px-3 text-sm text-ink-muted transition active:scale-95"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {addedNote && (
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-ink">
              {addedNote} נוספה — המחירים יופיעו אחרי העדכון הבא (או הריצו סריקה ידנית).
            </p>
          )}

          {loading ? (
            <p className="py-10 text-center text-ink-faint">טוען מחירים…</p>
          ) : ranking.stores.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-lg font-medium">אין עדיין מחירים ל{city}</p>
              <p className="mt-2 text-sm text-ink-muted">
                הרשימה נשלחת אוטומטית לבדיקה, והמחירים יתעדכנו בסריקה היומית הבאה.
              </p>
              {awaiting.length > 0 && (
                <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {awaiting.slice(0, 12).map((it) => (
                    <li
                      key={it.key}
                      className="rounded-full bg-track px-2.5 py-1 text-xs text-ink-muted"
                    >
                      {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-ink-faint">
                <span>{freshness(data?.updatedAt)}</span>
                <span>
                  {ranking.pricedCount} מתוך {ranking.basketCount} פריטים תומחרו
                </span>
              </div>

              {best && (
                <div className="rounded-2xl bg-accent-soft p-4 text-center">
                  <p className="text-sm text-accent-ink">הכי משתלם עבור הרשימה</p>
                  <p className="mt-1 font-display text-xl font-bold text-accent-ink">
                    {best.store.chain} {best.store.name}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-ink">{shekel(best.total)}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {best.covered} מתוך {ranking.pricedCount} מוצרים
                    {best.covered < ranking.pricedCount && ` · חסרים ${best.missing.length}`}
                  </p>
                </div>
              )}

              <ol className="flex flex-col gap-1.5">
                {ranking.stores.map((row, i) => {
                  const full = row.covered === ranking.pricedCount
                  return (
                    <li
                      key={row.store.key}
                      className={
                        'flex items-center gap-2 rounded-xl border px-3 py-2 ' +
                        (i === 0 ? 'border-accent bg-accent-soft' : 'border-edge')
                      }
                    >
                      <span className="w-6 shrink-0 text-center text-lg font-bold text-ink-muted">
                        {MEDALS[i] ?? i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {row.store.chain}{' '}
                          <span className="text-ink-muted">{row.store.name}</span>
                        </p>
                        <p className="text-xs text-ink-faint">
                          {full ? (
                            <span className="text-accent-ink">כל המוצרים</span>
                          ) : (
                            `${row.covered}/${ranking.pricedCount} מוצרים`
                          )}
                          {' · '}
                          {shekel(row.total)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setStore(row.store)}
                        className="shrink-0 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-accent-ink ring-1 ring-edge transition active:scale-95"
                      >
                        אני בסופר
                      </button>
                    </li>
                  )
                })}
              </ol>

              {ranking.stores.some((r) => r.covered < ranking.pricedCount) && (
                <p className="text-xs text-ink-faint">
                  שים לב: סניף עם פחות מוצרים עשוי להיראות זול יותר רק כי חלק מהמוצרים
                  חסרים בו — לכן הדירוג לפי כיסוי ואז לפי מחיר.
                </p>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowItems((v) => !v)}
                  className="flex min-h-11 w-full items-center justify-between rounded-xl bg-track px-3 text-sm font-medium text-ink-muted transition active:scale-[0.99]"
                >
                  <span>פירוט לפי מוצר</span>
                  <span aria-hidden>{showItems ? '▲' : '▼'}</span>
                </button>

                {showItems && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {ranking.items.map((it) => (
                      <li
                        key={it.key}
                        className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {it.name}
                            {it.qty > 1 && <span className="ms-1 text-ink-faint">×{it.qty}</span>}
                          </p>
                          {it.priced ? (
                            <p className="truncate text-xs text-ink-faint">{it.product}</p>
                          ) : (
                            <p className="text-xs text-ink-faint">ממתין לעדכון</p>
                          )}
                        </div>
                        {it.priced && it.cheapest && (
                          <div className="shrink-0 text-end">
                            <p className="text-sm font-bold">
                              {shekel(it.cheapest.price * it.qty)}
                            </p>
                            <p className="text-xs text-ink-faint">{it.cheapest.store.chain}</p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

interface StoreModeProps {
  store: PriceStore
  items: readonly Item[]
  itemByKey: Map<string, PricedItem>
  onBack: () => void
}

/** In-store view: the list in aisle order, each product's barcode for scanning. */
function StoreMode({ store, items, itemByKey, onBack }: StoreModeProps) {
  let total = 0
  let covered = 0
  const rows = items.map((item) => {
    const priced = itemByKey.get(nameKeyOf(item.name))
    const price = priced?.byStore[store.key] ?? null
    if (price != null) {
      total += price
      covered++
    }
    return { item, priced, price }
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-9 rounded-full bg-track px-3 text-sm font-medium text-ink-muted transition active:scale-95"
        >
          → חזרה לדירוג
        </button>
        <span className="ms-auto text-sm text-ink-muted">
          {covered}/{items.length} · {shekel(total)}
        </span>
      </div>

      <p className="text-xs text-ink-faint">
        סרקו את הברקוד בעמדת בדיקת מחיר בסניף, או מצאו את המוצר לפי השם.
      </p>

      <ul className="flex flex-col gap-2">
        {rows.map(({ item, priced, price }) => {
          const cat = getCategory(item.category)
          return (
            <li key={item.id} className="rounded-2xl border border-edge p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="me-1" aria-hidden>
                      {cat.emoji}
                    </span>
                    {item.name}
                    {item.qty && <span className="ms-1 text-xs text-ink-faint">{item.qty}</span>}
                  </p>
                  {priced ? (
                    <p className="truncate text-xs text-ink-muted">{priced.product}</p>
                  ) : (
                    <p className="text-xs text-ink-faint">לא תומחר עדיין</p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-bold">
                  {price != null ? (
                    shekel(price)
                  ) : priced ? (
                    <span className="text-ink-faint">לא בסניף</span>
                  ) : null}
                </span>
              </div>

              {priced && (
                <div className="mt-2 flex flex-col items-center gap-1">
                  <Barcode code={priced.barcode} />
                  <span className="font-mono text-xs tracking-wider text-ink-muted">
                    {priced.barcode}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
