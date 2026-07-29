// ────────────────────────────────────────────────────────────────────────────
// PAYLOAD MINIMIZATION (דיאטה לנתונים) — שלב לפני ה-Gather
// תיק אמיתי ("ארמה"/"קצב") מייצר JSONים חלקיים ענקיים. שליחת המסה הגולמית הזו
// ל-consolidateExtractedData הציפה את ה-InvokeLLM (Token Generation איטי) וה-Gateway ניתק
// את החיבור (Networking Error / Timeout). כאן מכווצים כל JSON חלקי ל"שלד" קל:
//  • מוחקים שדות כבדים ולא רלוונטיים לאיחוד (raw_text, page_numbers, _extraction_model וכו').
//  • זורקים מערכים ריקים לחלוטין ואובייקטים ריקים.
//  • משאירים אך ורק את מה שה-Gather צריך כדי לשייך לווים, ת"ז ועיסוקים.
// כך ה-Payload יורד דרמטית והקריאה המסכמת מסתיימת לפני רף ה-Timeout.
// ────────────────────────────────────────────────────────────────────────────

// שדות כבדים/רעשניים שאין בהם ערך לשלב האיחוד — נמחקים תמיד
const HEAVY_FIELDS = new Set([
  'raw_text', 'rawText', 'page_numbers', 'pages', 'page_number',
  '_extraction_model', '_extraction_rules', '_degraded_mode',
  '_failed_files_count', '_total_files_count', 'ocr_text', 'full_text',
  'document_text', 'source_text',
]);

// בודק אם ערך "ריק" (null/undefined/מחרוזת ריקה/מערך ריק/אובייקט ריק)
const isEmptyValue = (v) => {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};

// ניקוי רקורסיבי של אובייקט בודד: מסיר שדות כבדים + ערכים ריקים
const stripObject = (obj) => {
  if (Array.isArray(obj)) {
    const cleaned = obj.map(stripObject).filter(item => !isEmptyValue(item));
    return cleaned;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const key of Object.keys(obj)) {
      if (HEAVY_FIELDS.has(key)) continue;
      const cleanedVal = stripObject(obj[key]);
      if (!isEmptyValue(cleanedVal)) out[key] = cleanedVal;
    }
    return out;
  }
  return obj;
};

/**
 * מכווץ JSON חלקי אחד שחולץ מקובץ → שלד קל לשלב ה-Gather.
 * @param {object} partial - תוצאת חילוץ גולמית של קובץ/צ'אנק בודד
 * @returns {object} שלד מכווץ (ללא שדות כבדים וללא ריקים)
 */
export function minifyResult(partial) {
  if (!partial || typeof partial !== 'object') return {};
  return stripObject(partial);
}

/**
 * מכווץ מערך של JSONים חלקיים ומסנן החוצה תוצאות שהתרוקנו לגמרי.
 * @param {object[]} partialResults
 * @returns {object[]} מערך שלדים קלים בלבד
 */
export function minifyPartialResults(partialResults) {
  if (!Array.isArray(partialResults)) return [];
  return partialResults
    .map(minifyResult)
    .filter(p => p && typeof p === 'object' && Object.keys(p).length > 0);
}