import { useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { Barcode } from './Barcode'
import { CATEGORIES, getCategory, nameKeyOf } from '../lib/categories'
import { CITIES } from '../lib/cities'
import {
  cityData,
  quantityOf,
  rankBasket,
  variantAt,
  weightLabel,
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
/** Branches shown before "הצגת כל הסניפים": the rest are for whoever wants them. */
const TOP_STORES = 5

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
/** Weighed goods are priced per kilogram. */
const perUnit = (unit?: 'kg') => (unit === 'kg' ? ' לק״ג' : '')

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
  const [showAllStores, setShowAllStores] = useState(false)
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
          <span className="text-xs text-ink-faint">לפי נתוני שקיפות המחירים של הרשתות</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="min-h-11 rounded-full bg-track px-3 text-sm font-medium text-ink-muted transition active:scale-95 disabled:opacity-50"
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
          {/* City switcher: a list, because many cities can be tracked. */}
          <div className="flex items-center gap-2">
            {cities.length > 0 && (
              <select
                value={city}
                onChange={(e) => onCityChange(e.target.value)}
                aria-label="עיר"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-edge-strong bg-field px-3 text-sm font-medium text-ink"
              >
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
              className="min-h-11 shrink-0 rounded-xl border border-edge px-3 text-sm font-medium text-ink-muted transition active:scale-95"
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
                    className="min-h-11 rounded-full bg-track px-3 text-sm text-ink-muted transition active:scale-95"
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
          ) : active.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-lg font-medium">הרשימה ריקה</p>
              <p className="mt-2 text-sm text-ink-muted">
                הוסיפו מוצרים לרשימה כדי להשוות את המחיר שלהם בין הסופרים.
              </p>
            </div>
          ) : !data ? (
            <div className="py-6 text-center">
              <p className="text-lg font-medium">לא הצלחנו לטעון את המחירים</p>
              <p className="mt-2 text-sm text-ink-muted">בדקו את החיבור ולחצו על ״רענון״.</p>
            </div>
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
                  {ranking.pricedCount} מתוך {ranking.basketCount} מוצרים תומחרו
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
                  </p>
                  {best.missing.length > 0 && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      חסר בסניף: {best.missing.slice(0, 3).join(', ')}
                      {best.missing.length > 3 && ` ועוד ${best.missing.length - 3}`}
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-ink-faint">
                {ranking.items.some((it) => it.priced && it.unit !== 'kg') &&
                  'בכל סופר נלקח המוצר הזול ביותר באותו גודל. '}
                {ranking.items.some((it) => it.priced && it.unit === 'kg') &&
                  'מוצר במשקל מחושב לפי הכמות שכתבתם, או לפי ק״ג אחד אם לא כתבתם.'}
              </p>

              <ol className="flex flex-col gap-1.5">
                {(showAllStores ? ranking.stores : ranking.stores.slice(0, TOP_STORES)).map((row, i) => {
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
                        className="min-h-11 shrink-0 rounded-full bg-card px-3 text-xs font-medium text-accent-ink ring-1 ring-edge transition active:scale-95"
                      >
                        אני בסופר
                      </button>
                    </li>
                  )
                })}
              </ol>

              {ranking.stores.length > TOP_STORES && (
                <button
                  type="button"
                  onClick={() => setShowAllStores((v) => !v)}
                  className="min-h-11 rounded-xl border border-edge px-3 text-sm font-medium text-ink-muted transition active:scale-[0.99]"
                >
                  {showAllStores ? 'פחות סניפים' : `כל ${ranking.stores.length} הסניפים`}
                </button>
              )}

              {ranking.stores.some((r) => r.covered < ranking.pricedCount) && (
                <p className="text-xs text-ink-faint">
                  שים לב: סניף עם פחות מוצרים עשוי להיראות זול יותר רק כי חלק מהמוצרים
                  חסרים בו — לכן הדירוג לפי כיסוי ואז לפי מחיר.
                </p>
              )}

              <div>
                <button
                  type="button"
                  onClick={(e) => {
                    const button = e.currentTarget
                    setShowItems((v) => !v)
                    // What opens is below the fold; bring it into view.
                    if (!showItems) {
                      window.requestAnimationFrame(() =>
                        button.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                      )
                    }
                  }}
                  aria-expanded={showItems}
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
                            {it.unit === 'kg'
                              ? it.qty !== 1 && (
                                  <span className="ms-1 text-ink-faint">{weightLabel(it.qty)}</span>
                                )
                              : it.qty > 1 && <span className="ms-1 text-ink-faint">×{it.qty}</span>}
                          </p>
                          {it.priced ? (
                            <p className="truncate text-xs text-ink-faint">
                              {it.pinned && (
                                <span className="me-1" title="מוצר מוצמד" aria-hidden>
                                  📌
                                </span>
                              )}
                              {it.product}
                              {it.unit === 'kg' && ' · לפי משקל'}
                            </p>
                          ) : (
                            <p className="text-xs text-ink-faint">
                              {it.notFound ? 'לא נמצא בסופרים בעיר' : 'ממתין לעדכון'}
                            </p>
                          )}
                        </div>
                        {it.priced && it.cheapest && (
                          <div className="shrink-0 text-end">
                            <p className="text-sm font-bold">
                              {it.unit === 'kg' && it.qty === 1
                                ? shekel(it.cheapest.price) + perUnit(it.unit)
                                : shekel(it.cheapest.price * it.qty)}
                            </p>
                            <p className="text-xs text-ink-faint">
                              {it.unit === 'kg' &&
                                it.qty !== 1 &&
                                `${shekel(it.cheapest.price)}${perUnit(it.unit)} · `}
                              {it.cheapest.store.chain}
                            </p>
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
    const amount = quantityOf(item.qty, priced?.unit)
    if (price != null) {
      total += price * amount
      covered++
    }
    // What to actually take in THIS branch: a generic name is a different item per chain.
    const variant = priced && price != null ? variantAt(priced, store.key) : null
    return { item, priced, price, amount, variant }
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-full bg-track px-3 text-sm font-medium text-ink-muted transition active:scale-95"
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
        {rows.map(({ item, priced, price, amount, variant }) => {
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
                    <p className="truncate text-xs text-ink-muted">
                      {priced.unit === 'kg' && (
                        <span className="me-1" aria-hidden>
                          ⚖️
                        </span>
                      )}
                      {variant?.name ?? priced.product}
                      {priced.unit === 'kg' && ' · לפי משקל'}
                    </p>
                  ) : (
                    <p className="text-xs text-ink-faint">לא תומחר עדיין</p>
                  )}
                </div>
                <span className="shrink-0 text-end text-sm font-bold">
                  {price != null ? (
                    <>
                      {shekel(price * amount)}
                      {priced?.unit === 'kg' && (
                        <span className="block text-xs font-normal text-ink-faint">
                          {amount === 1
                            ? 'לק״ג'
                            : `${weightLabel(amount)} · ${shekel(price)}${perUnit(priced.unit)}`}
                        </span>
                      )}
                      {priced?.unit !== 'kg' && amount > 1 && (
                        <span className="block text-xs font-normal text-ink-faint">
                          {amount} × {shekel(price)}
                        </span>
                      )}
                    </>
                  ) : priced ? (
                    <span className="text-ink-faint">לא בסניף</span>
                  ) : null}
                </span>
              </div>

              {/* Weighed goods have no national barcode — you weigh them in the aisle. */}
              {variant?.code && (
                <div className="mt-2 flex flex-col items-center gap-1">
                  <Barcode code={variant.code} />
                  <span className="font-mono text-xs tracking-wider text-ink-muted">
                    {variant.code}
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
