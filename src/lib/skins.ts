export type SkinId = 'classic' | 'market' | 'night' | 'colorful'

export interface Skin {
  id: SkinId
  label: string
  /** Small preview swatches for the picker: [background, card, accent]. */
  swatch: [string, string, string]
}

export const SKINS: readonly Skin[] = [
  { id: 'classic', label: 'קלאסי', swatch: ['#fafaf9', '#ffffff', '#16a34a'] },
  { id: 'market', label: 'מחברת השוק', swatch: ['#f7f1e6', '#fffdf8', '#b95c27'] },
  { id: 'night', label: 'לילה בסופר', swatch: ['#0f1113', '#16191c', '#a3e635'] },
  { id: 'colorful', label: 'צבעי מכולת', swatch: ['#fbf9f4', '#e2f3dd', '#22a45d'] },
] as const

const KEY = 'skin'
const DEFAULT_SKIN: SkinId = 'classic'

function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && SKINS.some((s) => s.id === v)
}

export function getStoredSkin(): SkinId {
  try {
    const v = localStorage.getItem(KEY)
    return isSkinId(v) ? v : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

export function applySkin(skin: SkinId): void {
  document.documentElement.dataset.skin = skin
}

export function setStoredSkin(skin: SkinId): void {
  try {
    if (skin === DEFAULT_SKIN) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, skin)
  } catch {
    // Blocked storage: the skin still applies for this session.
  }
  applySkin(skin)
}
