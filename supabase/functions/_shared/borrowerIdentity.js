// ────────────────────────────────────────────────────────────────────────────
// Runtime-agnostic business logic — see shared/israeliId.js for the module
// conventions. Extracted from base44/functions/buildQuickReport/entry.ts.
// ────────────────────────────────────────────────────────────────────────────

import { isValidIsraeliId } from './israeliId.js';

// ════════════════════════════════════════════════════════════
// BLOCK 1 — IDENTITY VERIFIER
// תפקיד יחיד: אימות זהות לווה מול מסמכים שונים
// כולל: Triple Cross-Match (ת.ז × תלוש × עו"ש)
// מונע: הזיות ת.ז. של ילדים, ת.ז. פגות, חוסר שדות חובה
// ════════════════════════════════════════════════════════════
/**
 * @param {object} b - borrower record
 * @param {string} label - display label for this borrower ("לווה 1" etc.)
 * @param {object} rawData - the full extracted rawData (for cross-matching against payslips)
 * @returns {{risks: object[], missingDocs: string[]}}
 */
export function verifyBorrowerIdentity(b, label, rawData) {
  const risks = [];
  const missingDocs = [];

  // ── שמירה: גיל קטין — ת.ז. של ילד לעולם לא תהיה הלווה ──
  const age = b.age;
  if (age !== undefined && age !== null && age < 18) {
    risks.push({
      category: '🔴 ת.ז. קטין — שגיאת זיהוי',
      severity: 'critical',
      finding: `${label}: גיל ${age} — ת.ז. שזוהתה שייכת לקטין ולא ללווה. זוהי שגיאת זיהוי.`,
      recommendation: '🚫 יש לאמת ידנית את ת.ז. הלווה. ייתכן שנסרקה ת.ז. ילד של הלווה.'
    });
    missingDocs.push(`תעודת זהות של הלווה ${label} — ת.ז. קטין זוהתה בטעות`);
    return { risks, missingDocs };
  }

  // ── Triple Cross-Match — ת.ז × תלוש × עו"ש ──
  // כלל: כל לווה נבדק אל מול התלושים הספציפיים שלו בלבד
  // rawData מועבר כדי לאפשר לפונקציה לבחור את המקור הנכון
  const b1Slips = rawData.payslips_borrower1 || [];
  const b2Slips = rawData.payslips_borrower2 || [];
  const legacySlips = rawData.payslips || [];
  // זיהוי האם הלווה הוא לווה 1 או 2 לפי ת.ז.
  const isB1 = (rawData.borrowers?.[0]?.id || '').replace(/\D/g, '') === (b.id || '').replace(/\D/g, '');
  const relevantSlips = isB1
    ? (b1Slips.length > 0 ? b1Slips : legacySlips)
    : (b2Slips.length > 0 ? b2Slips : []);
  const idClean = (b.id || '').replace(/\D/g, '');
  // ── FIX: אימות ת.ז. מתלוש שכר
  // תלוש מרנד/סילנטיום שימוש: מספר_עובד (מספר 4 ספרות כמו 1420, 0045) ≠ ת.ז.
  // ת.ז. ישראלית = בדיוק 9 ספרות, מופיעה בשדה id_number בנתונים אישיים
  // לכן: בדיקת ת.ז. מבוצעת רק כנגד שדה id_number (9 ספרות), לא employee_id קצר.
  const idFromPayslips = relevantSlips
    .flatMap(p => {
      const candidates = [];
      // עדיפות 1: שדה id_number מפורש (ת.ז. בנתונים אישיים)
      // חייב לעבור checksum ישראלי — מספרי עובד (1420, 0045, 123456789) יכשלו
      if (p.id_number) {
        const idClean = (p.id_number || '').replace(/\D/g, '');
        // THREE-ZERO RULE: מספר שמתחיל ב-000 הוא מספר עובד ממולא — לא ת.ז.
        // דוגמאות נפסלות: "000001420", "000000045"
        if (!idClean.startsWith('000') && isValidIsraeliId(idClean)) candidates.push(idClean);
      }
      // employee_id = מספר עובד פנימי — לעולם לא ת.ז. — נדחה תמיד
      return candidates;
    })
    .filter(id => id && id.length === 9);

  if (idClean.length === 9 && idFromPayslips.length > 0) {
    const idNorm = idClean.replace(/^0+/, '');
    const matchedInPayslip = idFromPayslips.some(pid => {
      const pidNorm = pid.replace(/^0+/, '');
      if (pidNorm === idNorm) return true;
      if (idNorm.includes(pidNorm) || pidNorm.includes(idNorm)) return true;
      const shared = idNorm.split('').filter((c, i) => pidNorm[i] === c).length;
      return shared >= 7;
    });
    if (!matchedInPayslip) {
      risks.push({
        category: '⚠️ אי-התאמת ת.ז. בין מסמכים',
        severity: 'HIGH',
        finding: `${label}: ת.ז. ${idClean} לא מופיעה בתלושי השכר. ת.ז. בתלוש: ${[...new Set(idFromPayslips)].join(', ')}.`,
        recommendation: 'יש לאמת ידנית ולוודא שת.ז. בתלושים תואמת לת.ז. בתעודת הזהות.'
      });
    }
  }

  // ── בדיקת קיום פיזי של מסמך ת.ז. ──
  if (b.id_document_found === false) {
    risks.push({
      category: '🔴 תעודת זהות חסרה — מסמך ייעודי לא הועלה',
      severity: 'HIGH',
      finding: `${label} (ת.ז. ${b.id || 'לא ידוע'}): מספר ת.ז. זוהה ממסמך אחר, אך לא הועלה מסמך ת.ז. ייעודי.`,
      recommendation: `🚫 חובה להעלות תעודת זהות / ספח ביומטרי פיזי של ${label}.`
    });
    missingDocs.push(`תעודת זהות / ספח ביומטרי — ${label} (מספר זוהה אך אין מסמך פיזי)`);
  }

  // ── בדיקת שדות חובה — רק מספר ת.ז. (תאריך לידה ותאריך הנפקה אינם חסמים) ──
  // תאריך הנפקה = id_issue_date — לעולם לא שדה חובה, לא אזהרה, לא נכלל כאן
  // תאריך תוקף = id_expiry_date — בודקים בנפרד למטה
  const idMissingFields = [];
  if (!idClean || idClean.length !== 9) idMissingFields.push('מספר ת.ז.');
  // CRITICAL: never push 'תאריך הנפקת ת.ז.' or any id_issue_date variant to idMissingFields
  if (idMissingFields.length > 0 && b.id_document_found !== false) {
    risks.push({
      category: '⚠️ נתוני ת.ז. חלקיים',
      severity: 'HIGH',
      finding: `${label}: חסרים שדות חובה: ${idMissingFields.join(', ')}.`,
      recommendation: `🚫 יש לוודא שהמסמך המועלה כולל: ${idMissingFields.join(', ')}.`
    });
    idMissingFields.forEach(f => missingDocs.push(`${f} — ${label}`));
  }

  // ── בדיקת תוקף ת.ז. — id_expiry_date הוא תאריך פג תוקף הביומטרי ──
  // אם id_expiry_date קיים ועבר → חסם (הבנק לא מקבל ת.ז. פגת תוקף)
  // אם id_expiry_date חסר לגמרי → אין אזהרה (ביומטרי ישן לפעמים לא מכיל שדה זה)
  // id_issue_date אינו שדה חובה — לעולם לא חוסם
  if (b.id_expiry_date) {
    const parts = b.id_expiry_date.replace(/\./g, '/').split('/');
    let expDate = null;
    if (parts.length === 3) expDate = parts[0].length === 4
      ? new Date(+parts[0], +parts[1] - 1, +parts[2])
      : new Date(+parts[2], +parts[1] - 1, +parts[0]);
    if (expDate && !isNaN(expDate.getTime())) {
      const today = new Date();
      if (expDate < today) {
        risks.push({
          category: '🔴 תעודת זהות פגת תוקף',
          severity: 'HIGH',
          finding: `${label}: תעודת הזהות פגת תוקף ב-${b.id_expiry_date}. הבנק לא יקבל ת.ז. שפג תוקפה.`,
          recommendation: '🚫 חובה לחדש את תעודת הזהות במשרד הפנים לפני הגשה לבנק.'
        });
        missingDocs.push(`תעודת זהות בתוקף — ${label} (פגת תוקף ב-${b.id_expiry_date})`);
      } else {
        // ת.ז. בתוקף — מידע חיובי, אפשר להוסיף לחוזקות (אין אזהרה)
        const monthsLeft = Math.round((expDate - today) / (1000 * 60 * 60 * 24 * 30));
        if (monthsLeft < 6) {
          risks.push({
            category: '⚠️ תעודת זהות — תוקף מסתיים בקרוב',
            severity: 'MEDIUM',
            finding: `${label}: תוקף תעודת הזהות מסתיים ב-${b.id_expiry_date} (${monthsLeft} חודשים). חלק מהבנקים דורשים תוקף של לפחות 6 חודשים.`,
            recommendation: 'מומלץ לחדש את תעודת הזהות לפני הגשה לבנק.'
          });
        }
      }
    }
  }

  return { risks, missingDocs };
}
