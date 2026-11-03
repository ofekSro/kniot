/**
 * Cities offered in the "add city" picker. The nightly job matches a city by
 * name against the chains' store files (also folding "קריית"/"קרית") and by its
 * CBS settlement code (scripts/cityCodes.json) for chains that store the code
 * instead of the name. Not exhaustive — any city the couple adds is attempted
 * on the next run, and shows data only if a chain has a branch there.
 */
export const CITIES = [
  'חיפה',
  'תל אביב',
  'ירושלים',
  'ראשון לציון',
  'פתח תקווה',
  'אשדוד',
  'נתניה',
  'באר שבע',
  'חולון',
  'בני ברק',
  'רמת גן',
  'רחובות',
  'בת ים',
  'אשקלון',
  'הרצליה',
  'כפר סבא',
  'רעננה',
  'חדרה',
  'מודיעין',
  'לוד',
  'רמלה',
  'נהריה',
  'עכו',
  'קריית אתא',
  'קריית ביאליק',
  'קריית מוצקין',
  'קריית ים',
  'נצרת',
  'טבריה',
  'כרמיאל',
  'עפולה',
  'אילת',
  'דימונה',
  'קריית גת',
  'יבנה',
  'נס ציונה',
  'גבעתיים',
  'הוד השרון',
  'ראש העין',
  'אור יהודה',
] as const
