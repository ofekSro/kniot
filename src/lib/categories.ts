export type CategoryId =
  | 'produce'
  | 'bakery'
  | 'dairy'
  | 'meat'
  | 'frozen'
  | 'pantry'
  | 'snacks'
  | 'drinks'
  | 'cleaning'
  | 'toiletries'
  | 'other'

export interface Category {
  id: CategoryId
  label: string
  emoji: string
}

/** Fixed order = the walking route through the store. Index is the sort index. */
export const CATEGORIES: readonly Category[] = [
  { id: 'produce', label: 'ירקות ופירות', emoji: '🥬' },
  { id: 'bakery', label: 'לחם ומאפים', emoji: '🍞' },
  { id: 'dairy', label: 'חלבי וביצים', emoji: '🥛' },
  { id: 'meat', label: 'בשר ודגים', emoji: '🍗' },
  { id: 'frozen', label: 'קפואים', emoji: '🧊' },
  { id: 'pantry', label: 'יבשים ושימורים', emoji: '🥫' },
  { id: 'snacks', label: 'חטיפים ומתוקים', emoji: '🍫' },
  { id: 'drinks', label: 'שתייה', emoji: '🥤' },
  { id: 'cleaning', label: 'ניקיון', emoji: '🧽' },
  { id: 'toiletries', label: 'טואלטיקה', emoji: '🧴' },
  { id: 'other', label: 'אחר', emoji: '🛒' },
] as const

export const DEFAULT_CATEGORY: CategoryId = 'other'

/**
 * An oklch hue per category, consumed by skins that color-code categories
 * ("צבעי מכולת" tints cards with it, "לילה בסופר" draws an accent bar).
 * The CSS derives actual colors from the hue, so one number serves both
 * light and dark variants.
 */
export const CATEGORY_HUES: Record<CategoryId, number> = {
  produce: 145,
  bakery: 75,
  dairy: 250,
  meat: 30,
  frozen: 220,
  pantry: 85,
  snacks: 340,
  drinks: 195,
  cleaning: 270,
  toiletries: 310,
  other: 255,
}

const CATEGORY_BY_ID = new Map<string, Category>(CATEGORIES.map((c) => [c.id, c]))

const FALLBACK: Category = { id: 'other', label: 'אחר', emoji: '🛒' }

/** Never throws — an unknown id from an old document degrades to "אחר". */
export function getCategory(id: string): Category {
  return CATEGORY_BY_ID.get(id) ?? FALLBACK
}

export function categoryIndex(id: string): number {
  const i = CATEGORIES.findIndex((c) => c.id === id)
  return i === -1 ? CATEGORIES.length : i
}

export function isCategoryId(id: string): id is CategoryId {
  return CATEGORY_BY_ID.has(id)
}

/**
 * Hebrew keyword stems.
 *
 * A single-word stem matches a word that STARTS with it, so inflections are
 * covered ("עגבני" → עגבניה/עגבניות) without a short stem swallowing unrelated
 * products. A stem containing a space is matched against the whole name instead.
 *
 * Because the longest match wins (see guessCategory), overlapping stems across
 * categories resolve correctly on their own: "שוקולד" beats "שוקו", and
 * "חלב" beats "חלה"'s shorter neighbours. Keep stems as long as the shortest
 * real product name they need to catch.
 */
const KEYWORDS: Record<CategoryId, readonly string[]> = {
  produce: [
    'ירק', 'ירקות', 'פירות', 'עגבני', 'מלפפון', 'בצל', 'שומ', 'שום', 'תפוח',
    'תפוחי', 'בננ', 'גזר', 'חסה', 'לימון', 'תפוז', 'אבטיח', 'מלון', 'ענב',
    'תות', 'אגס', 'אפרסק', 'שזיף', 'פלפל', 'חציל', 'קישוא', 'כרוב', 'כרובית',
    'תרד', 'פטרוזיל', 'כוסבר', 'שמיר', 'נענע', 'בטטה', 'תפוד', 'דלעת',
    'ברוקולי', 'אבוקדו', 'רימון', 'תמר', 'מנגו', 'קלמנטינ', 'פטרי', 'זית',
    'זיתים', 'סלרי', 'לפת', 'צנון', 'ליים', 'אשכולי', 'נקטרינ', 'דובדבן',
    'אוכמני', 'פפאיה', 'ליצ׳י', 'ארטישוק', 'שעועית ירוקה', 'תירס',
  ],
  bakery: [
    'לחם', 'לחמני', 'פיתה', 'פיתות', 'חלה', 'חלות', 'בגט', 'מאפה', 'מאפים',
    'בורק', 'קרוסון', 'רוגלך', 'טוסט', 'לאפה', 'מצה', 'מצות', 'עוגה', 'עוגת',
    'באגט', 'צימל', 'קרקר לחם', 'פוקצ', 'ברוש',
  ],
  dairy: [
    'חלב', 'חלבי', 'גבינ', 'יוגורט', 'ביצ', 'חמאה', 'שמנת', 'קוטג', 'לבנה',
    'אשל', 'מעדן', 'צהובה', 'מוצרל', 'פטה', 'בולגרית', 'שוקו', 'ריקוטה',
    'מסקרפונה', 'קממבר', 'גאודה', 'חלבית', 'תחליף חלב', 'שמנת חמוצה',
  ],
  meat: [
    'עוף', 'בשר', 'דגים', 'סלמון', 'טונה', 'הודו', 'קציצ', 'שניצל', 'כבד',
    'נקני', 'המבורגר', 'אנטריקוט', 'כתף', 'שוקי', 'שוקיים', 'כנפי', 'חזה',
    'טחון', 'בקר', 'כבש', 'דניס', 'בורי', 'פילה', 'אסאדו', 'צלעות', 'פרגית',
    'שווארמה', 'קבב', 'מוסר', 'אמנון', 'לברק',
  ],
  frozen: [
    'קפוא', 'קפואים', 'גלידה', 'גלידת', 'ארטיק', 'מלאווח', 'ג׳חנון', 'גחנון', 'פיצה',
    'בצק עלים', 'שלגון', 'קרטיב', 'ירקות קפואים',
  ],
  pantry: [
    'אורז', 'פסטה', 'ספגטי', 'קמח', 'סוכר', 'מלח', 'שמן', 'חומץ', 'קטשופ',
    'מיונז', 'חרדל', 'טחינ', 'חומוס', 'שימור', 'רסק', 'עדש', 'שעועית',
    'גרגר', 'קוסקוס', 'בורגול', 'קינואה', 'שיבולת', 'קורנפלקס', 'דבש',
    'ריבה', 'תבלין', 'פפריק', 'כמון', 'סודה לשתייה', 'אבקת אפייה', 'שמרים',
    'שקד', 'שקדים', 'אגוז', 'צימוק', 'גרנול', 'פתית', 'נודלס', 'רוטב',
    'פירה', 'מרק', 'סילאן', 'שומשום', 'זעתר', 'כורכום', 'קרם קוקוס',
  ],
  snacks: [
    'חטיף', 'שוקולד', 'ביסלי', 'במבה', 'צ׳יפס', "צ'יפס", 'תפוצ', 'עוגי',
    'עוגיות', 'ופל', 'סוכרי', 'מסטיק', 'חלווה', 'קרקר', 'פרינגל', 'דורית',
    'נוגט', 'מרשמלו', 'פופקורן', 'בונבון', 'טופי', 'מנטוס', 'קינדר',
    'שוקולית', 'נוטלה', 'ממתק',
  ],
  drinks: [
    'מים', 'קולה', 'משקה', 'מיץ', 'ספרייט', 'פאנטה', 'סודה', 'בירה', 'יין',
    'וודקה', 'ערק', 'קפה', 'תה', 'נסקפה', 'אנרגי', 'שתייה', 'לימונד',
    'סחוט', 'שוופס', 'קרו', 'ויסקי', 'סיידר', 'תרכיז',
  ],
  cleaning: [
    'ניקוי', 'ניקיון', 'אקונומיקה', 'סבון כלים', 'נוזל כלים', 'כלים',
    'ריצפה', 'רצפה', 'אבקת כביסה', 'כביסה', 'מרכך כביסה', 'מטליות', 'ספוג',
    'שקיות', 'זבל', 'אשפה', 'נייר סופג', 'מגבונים', 'סמרטוט', 'מדיח',
    'ניקוי תנור', 'אמוניה', 'ווניש', 'סנו', 'מטהר', 'חומרי ניקוי', 'כפפות',
  ],
  toiletries: [
    'שמפו', 'מרכך שיער', 'סבון', 'משחת שיניים', 'שיניים', 'מברשת', 'דאודורנט',
    'גילוח', 'טואלט', 'טישו', 'חיתול', 'תחבוש', 'טמפון', 'קרם', 'מקלוני',
    'אודנט', 'קרם פנים', 'קרם גוף', 'ג׳ל רחצה', 'אל סבון', 'תחליב',
    'משחת גילוח', 'קוטלי', 'פדים',
  ],
  other: [],
}

/** Hebrew one-letter prefixes that attach to a noun (ה/ו/ב/כ/ל/מ/ש). */
const PREFIX_RE = /^[הובכלמש]/

/**
 * Final ("sofit") forms map to their regular counterparts, so a stem written in
 * the singular still matches the plural: מלפפון → מלפפונ, which is a prefix of
 * מלפפונים → מלפפונימ. Without this, every ן/ם/ך/ף/ץ ending silently fails.
 */
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

function normalize(text: string): string {
  return text
    .toLowerCase()
    // Strip niqqud and Hebrew punctuation that users rarely type consistently.
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`״׳]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .trim()
}

/**
 * Keywords run through the same normalization as the input — otherwise a stem
 * ending in a final letter ("לחם") could never match a normalized word ("לחמ").
 */
const NORMALIZED_KEYWORDS: ReadonlyArray<{ id: CategoryId; kw: string }> =
  CATEGORIES.flatMap(({ id }) =>
    KEYWORDS[id].map((kw) => ({ id, kw: normalize(kw) })),
  )

function splitWords(text: string): string[] {
  return normalize(text)
    .split(/[\s,.\-/()]+/)
    .filter(Boolean)
}

/**
 * Guesses a category from a product name.
 *
 * The longest matching keyword wins, regardless of category order. That is what
 * keeps "שוקולד" (snacks) from being captured by "שוקו" (dairy), and "חלב"
 * (dairy) from being captured by a shorter bakery stem. Ties fall back to the
 * store-route order, so the earlier aisle wins.
 *
 * Returns "other" when nothing matches — a wrong guess is easy to fix in the
 * edit sheet, and history overrides the guess from the second purchase onward.
 */
export function guessCategory(name: string): CategoryId {
  const full = normalize(name)
  if (!full) return DEFAULT_CATEGORY

  const words = splitWords(name)
  // Each word, plus a copy without its Hebrew prefix letter ("הלחם" → "לחם"),
  // keeping the original position so the head noun keeps its advantage.
  const candidates: Array<{ word: string; index: number }> = []
  words.forEach((word, index) => {
    candidates.push({ word, index })
    if (word.length > 3 && PREFIX_RE.test(word)) {
      candidates.push({ word: word.slice(1), index })
    }
  })

  // Rank: phrases (multi-word stems) beat everything; then the EARLIEST word
  // with any match wins outright — in a Hebrew construct phrase the head noun
  // comes first, so "חלב שיבולת שועל" is milk, not oats, no matter how long the
  // later word's keyword is. Only within the same word does the longer, more
  // specific stem win; remaining ties fall to the earlier store-route category.
  let bestRank = Number.MAX_SAFE_INTEGER
  let bestScore = 0
  let bestCategory: CategoryId = DEFAULT_CATEGORY

  for (const { id, kw } of NORMALIZED_KEYWORDS) {
    let rank = Number.MAX_SAFE_INTEGER
    let score = 0

    if (kw.includes(' ')) {
      if (full.includes(kw)) {
        rank = -1
        score = kw.length
      }
    } else {
      for (const { word, index } of candidates) {
        if (!word.startsWith(kw)) continue
        const hit = kw.length + (word === kw ? 1 : 0)
        if (index < rank || (index === rank && hit > score)) {
          rank = index
          score = hit
        }
      }
    }

    if (rank < bestRank || (rank === bestRank && score > bestScore)) {
      bestRank = rank
      bestScore = score
      bestCategory = id
    }
  }

  return bestCategory
}

/**
 * Canonical key for history/favorites doc ids and duplicate detection.
 * Slashes are stripped because the key is used directly as a Firestore
 * document id, where "/" would be read as a path separator.
 */
export function nameKeyOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\//g, '-')
    .slice(0, 200)
}
