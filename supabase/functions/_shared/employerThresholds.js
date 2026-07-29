// ────────────────────────────────────────────────────────────────────────────
// Sector logic (תיקון לקראת מצגת בנק הפועלים):
// עובדי חינוך/ממשלה → הפרשות גבוהות הן נורמטיביות, לא דגל אדום.
// Extracted from base44/functions/buildUnderwriterReportHelpers/entry.ts.
// ────────────────────────────────────────────────────────────────────────────

/**
 * isGovtOrEducationEmployer — בדיקה אם מעסיק הוא ממשלה/חינוך/ציבורי
 * עובדים אלו מחויבים בהפרשות פנסיה+קה"ל+ביטוח גבוהות → יחס נטו/ברוטו נמוך הוא נורמטיבי.
 * @param {string} employerStr
 * @returns {boolean}
 */
export function isGovtOrEducationEmployer(employerStr) {
  const GOVT_KEYWORDS = [
    'חינוך', 'הוראה', 'עירייה', 'עיריית', 'מועצה', 'משרד', 'ממשלה',
    'צבא', 'צה"ל', 'משטרה', 'רשות', 'אוניברסיטה', 'בית חולים',
    'הדסה', 'שיבא', 'ביקור חולים', 'מדינה', 'שב"ס', 'כנסת',
    'בטל"מ', 'מטח', 'education', 'ministry', 'municipality'
  ];
  const lower = (employerStr || '').toLowerCase();
  return GOVT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * getGrossNetThresholdForSector — סף יחס נטו/ברוטו לפי סקטור
 * ממשלה/חינוך: 42% (ניכויי חובה גבוהים מאוד)
 * הכנסה גבוהה: 53%
 * רגיל: 60-65%
 * @param {number} gross
 * @param {boolean} isGovtOrEdu
 * @returns {number}
 */
export function getGrossNetThresholdForSector(gross, isGovtOrEdu) {
  if (isGovtOrEdu) return 0.42;
  if (gross > 30000) return 0.53;
  if (gross > 20000) return 0.60;
  return 0.65;
}
