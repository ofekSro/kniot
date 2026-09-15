import type { Item } from '../types'

interface Props {
  item: Item
  highlighted: boolean
  onToggle: (id: string, next: boolean) => void
  onOpen: (item: Item) => void
}

export function ItemRow({ item, highlighted, onToggle, onOpen }: Props) {
  return (
    <li
      className={
        'flex items-stretch gap-1 rounded-xl ' +
        (highlighted ? 'motion-safe:animate-[row-flash_1.2s_ease-out]' : '')
      }
    >
      <label
        className="flex min-h-12 shrink-0 cursor-pointer items-center ps-2 pe-1"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={item.bought}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          aria-label={item.bought ? `לבטל קנייה של ${item.name}` : `לסמן ${item.name} כנקנה`}
          className="size-6 cursor-pointer accent-accent"
        />
      </label>

      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-h-12 flex-1 flex-col justify-center gap-0.5 rounded-xl px-1 py-2 text-start transition active:bg-track"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={
              'font-medium ' +
              (item.bought
                ? 'text-ink-faint line-through'
                : 'text-ink')
            }
          >
            {item.name}
          </span>
          {item.qty && (
            <span className="rounded-md bg-track px-1.5 py-0.5 text-xs font-medium text-ink-muted">
              {item.qty}
            </span>
          )}
        </span>
        {item.note && (
          <span className="text-xs text-ink-muted">{item.note}</span>
        )}
      </button>
    </li>
  )
}
