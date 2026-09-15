import { useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { rankBasket, type PriceData } from '../lib/prices'
import type { Item } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  active: readonly Item[]
  data: PriceData | null
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
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

function shekel(n: number): string {
  return '₪' + n.toFixed(2)
}

/**
 * "איפה הכי זול" — ranks the city's branches for the current basket, cheapest
 * first but coverage first (a branch that stocks fewer of the basket's items
 * shows a lower total without being cheaper). Prices come from the nightly
 * snapshot; the ranking itself is computed live from the current list.
 */
export function PriceCheckSheet({
  open,
  onClose,
  active,
  data,
  loading,
  refreshing,
  onRefresh,
}: Props) {
  const [showItems, setShowItems] = useState(false)

  const ranking = useMemo(
    () => rankBasket(active.map((a) => ({ name: a.name, qty: a.qty })), data),
    [active, data],
  )

  const best = ranking.stores[0]
  const awaiting = ranking.items.filter((it) => !it.priced)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="איפה הכי זול"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-faint">
            {data ? `${data.city} · נתוני chp.co.il` : 'נתוני chp.co.il'}
          </span>
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
      {loading ? (
        <p className="py-10 text-center text-ink-faint">טוען מחירים…</p>
      ) : !data || ranking.stores.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-lg font-medium">אין עדיין נתוני מחירים לרשימה</p>
          <p className="mt-2 text-sm text-ink-muted">
            הרשימה נשלחת אוטומטית לבדיקת מחירים, והמחירים יתעדכנו בסריקה היומית
            הבאה. אחרי העדכון, לחיצה כאן תדרג את הסניפים בעיר מהזול ליקר.
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
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span>{freshness(data.updatedAt)}</span>
            <span>
              {ranking.pricedCount} מתוך {ranking.basketCount} פריטים תומחרו
            </span>
          </div>

          {/* Recommended branch */}
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

          {/* Full ranking */}
          <ol className="flex flex-col gap-1.5">
            {ranking.stores.map((row, i) => {
              const full = row.covered === ranking.pricedCount
              return (
                <li
                  key={row.store.key}
                  className={
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 ' +
                    (i === 0 ? 'border-accent bg-accent-soft' : 'border-edge')
                  }
                >
                  <span className="w-7 shrink-0 text-center text-lg font-bold text-ink-muted">
                    {MEDALS[i] ?? i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {row.store.chain} <span className="text-ink-muted">{row.store.name}</span>
                    </p>
                    <p className="text-xs text-ink-faint">
                      {full ? (
                        <span className="text-accent-ink">כל המוצרים</span>
                      ) : (
                        `${row.covered}/${ranking.pricedCount} מוצרים`
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-lg font-bold">
                    {shekel(row.total)}
                  </span>
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

          {/* Per-item breakdown */}
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
                        {it.qty > 1 && (
                          <span className="ms-1 text-ink-faint">×{it.qty}</span>
                        )}
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
        </div>
      )}
    </Sheet>
  )
}
