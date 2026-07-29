import React, { useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldX, ChevronDown, ChevronUp, AlertTriangle, XCircle, Info } from 'lucide-react';

/**
 * AnomalyShield — שלב 4: סורק המוקשים (Red Flag Detection)
 *
 * לוגיקה דטרמיניסטית בלבד — ללא קריאת LLM.
 * סורק 3 שכבות:
 *   1. Keyword Scanner   — כשלים בנקאיים (BDI / עיקולים)
 *   2. Shadow Debts      — חובות צל בעו"ש שאינם מדווחים
 *   3. Behavioral Risk   — הימורים, קריפטו, משיכות קיצוניות
 */

// ── מילות מפתח BDI קריטיות — אך ורק כשל/חזרה מפורש ──
// חשוב: "החזר חודשי" (תשלום הלוואה תקין) אינו BDI!
// רק מילות כשל מפורשות: חזרת שיק, אי-כיבוד, הגבלה, עיקול וכו'
const BDI_KEYWORDS = [
  "אכ\"מ", 'אכמ', 'אי כיבוד', 'אי-כיבוד', 'יתרה בלתי מספקת',
  'חזרת שיק', "חזרת צ'ק", 'הוראה לא כובדה', 'חזרת הוראה',
  'returned', 'bounced', 'nsf', 'dishonored', 'insufficient funds',
  'ס.ע.', 'הגבלה', 'מוגבל', 'הוצאה לפועל', 'עיקול',
  'אי כיסוי', 'אין כיסוי', 'סורב',
];

// ── קטגוריות שאינן BDI — הלוואה תקינה היא התחייבות בלבד ──
const NON_BDI_CATEGORIES = [
  'הלוואות קיימות', 'הלוואה', 'נסיבות מיוחדות',
  'כרטיסי אשראי', 'חוזקות', 'מסמכים',
];

// ── מילות מפתח Shadow Debt ──
const SHADOW_DEBT_LENDERS = [
  'מימון ישיר', 'פנינה', 'פפר', 'pepper', 'כאל', 'max', 'מקס',
  'ויזה קל', 'אמריקן אקספרס', 'amex', 'לאומי קארד', 'one zero',
  'הלוואה', 'אשראי', 'קרדיט', 'credit', 'finance', 'fintech',
  'הפרשה', 'החזר הלוואה', 'תשלום קבוע',
];

// ── גופי הימורים / קריפטו ──
const GAMBLING_KEYWORDS = [
  'הימור', 'גיימינג', 'gaming', 'casino', 'bet365', 'betway',
  'ווינר', 'winner', 'rush', 'lotto', 'פיס', 'הגרלה',
];
const CRYPTO_KEYWORDS = [
  'ביטקוין', 'bitcoin', 'crypto', 'binance', 'coinbase',
  'ethereum', 'קריפטו', 'nft', 'web3',
];

// ── ניתוח אנומליות ──
export function detectAnomalies(result) {
  const flags = [];      // קריטי — עוצר עסקה
  const warnings = [];   // אזהרה — דורש בירור
  const clears = [];     // ירוק — נבדק ותקין

  const b = result?.borrower_info || {};
  const totalIncome = b.total_household_income || b.avg_income || 0;

  // === שכבה 1: BDI Keyword Scanner ===
  // כלל: BDI מופעל רק אם קיים ביטוי כשל מפורש (חזרת שיק, עיקול, הגבלה, אכ"מ וכו')
  // הלוואות תקינות (קטגוריה "הלוואות קיימות") אינן BDI — הן התחייבות (Liability)

  const isBDIFinding = (text, category = '') => {
    // אם הקטגוריה היא "הלוואות קיימות" — לא BDI בשום אופן
    if (NON_BDI_CATEGORIES.some(c => (category || '').includes(c))) return false;
    // בדיקת מילות כשל מפורשות בלבד
    return BDI_KEYWORDS.some(kw => (text || '').toLowerCase().includes(kw.toLowerCase()));
  };

  // בדיקה ב-risk_radar — רק ממצאים שאינם הלוואות תקינות
  const bdiFlags = result?.risk_radar?.filter(r =>
    isBDIFinding(r.finding, r.category)
  ) || [];

  // בדיקה ישירה בדגלי BDI שמגיעים מהמסמכים (כבר מסוננים ב-backend)
  const rawBDIFlags = result?.bdi_red_flags || result?._rawBDIFlags || [];
  const confirmedBDI = rawBDIFlags.filter(f =>
    BDI_KEYWORDS.some(kw => String(f).toLowerCase().includes(kw.toLowerCase()))
  );

  if (confirmedBDI.length > 0) {
    confirmedBDI.forEach(f => {
      flags.push({
        severity: 'critical',
        category: 'כשל בנקאי — BDI',
        icon: '🔴',
        title: 'כשל בנקאי מאומת',
        detail: String(f),
        action: 'נדרש בירור מעמיק מול הלקוח לפני כל המשך טיפול',
      });
    });
  } else if (bdiFlags.length > 0) {
    bdiFlags.forEach(r => {
      flags.push({
        severity: 'critical',
        category: 'כשל בנקאי — BDI',
        icon: '🔴',
        title: 'זוהה כשל בנקאי חמור',
        detail: r.finding,
        action: 'נדרש בירור מעמיק — חזרת שיק / אי-כיבוד עלולים לסגור את הדלת בבנקים',
      });
    });
  } else {
    clears.push({ category: 'BDI', title: 'לא זוהו כשלים בנקאיים', detail: 'אין חזרות / עיקולים / הגבלות בנתונים שנסרקו' });
  }

  // עיקול שכר
  const hasWageGarnishment = result?.risk_radar?.some(r =>
    (r.finding || '').includes('עיקול שכר') || (r.finding || '').includes('עיקול')
  );
  if (hasWageGarnishment) {
    flags.push({
      severity: 'critical',
      category: 'עיקול / הוצאה לפועל',
      icon: '🔴',
      title: 'עיקול שכר זוהה',
      detail: 'קיימת הוראת עיקול פעילה — מפחית ישירות מכושר ההחזר ועלול לגרום לדחייה',
      action: 'יש לבצע בירור מלא ולכמת את הסכום המעוקל',
    });
  }

  // === שכבה 2: Shadow Debts ===
  // חוב צל = חיוב קבוע לגוף פיננסי שאינו מופיע בריכוז ההלוואות
  // אין לחפף עם BDI — ממצא שכבר עלה כ-BDI לא יופיע שוב כאן
  const alreadyFlaggedAssets = new Set(bdiFlags.map(r => r.finding));
  const undisclosedIndicators = result?.risk_radar?.filter(r =>
    !alreadyFlaggedAssets.has(r.finding) && (
      (r.finding || '').includes('לא מדווח') ||
      (r.finding || '').includes('חוב צל') ||
      (r.finding || '').toLowerCase().includes('shadow') ||
      (r.finding || '').includes('הלוואה לא מדווחת') ||
      (r.finding || '').includes('ניכוי ביטוח') ||
      ((r.category || '').includes('הלוואה') && (r.finding || '').includes('לא דווח'))
    )
  ) || [];

  if (undisclosedIndicators.length > 0) {
    undisclosedIndicators.forEach(r => {
      warnings.push({
        severity: 'warning',
        category: 'חוב צל',
        icon: '🟡',
        title: 'תשלום קבוע לא מזוהה',
        detail: r.finding,
        action: 'יש לשאול את הלקוח על מקור החיוב ולוודא שנכלל בחישוב ה-PTI',
      });
    });
  } else {
    clears.push({ category: 'חובות צל', title: 'לא זוהו חובות צל', detail: 'כל החיובים הקבועים בעו"ש תואמים להלוואות המדווחות' });
  }

  // === שכבה 3: Behavioral Risk ===
  const riskRadar = result?.risk_radar || [];

  // הימורים
  const hasGambling = riskRadar.some(r =>
    GAMBLING_KEYWORDS.some(kw => (r.finding || '').toLowerCase().includes(kw.toLowerCase()))
  ) || result?.gambling_detected;
  if (hasGambling) {
    flags.push({
      severity: 'critical',
      category: 'AML — הימורים',
      icon: '🔴',
      title: 'עסקאות הימורים זוהו',
      detail: 'פעילות הימורים בדפי העו"ש — דגל AML שעלול לחסום את הבקשה בבנקים',
      action: 'נדרש הסבר בכתב מהלקוח ואימות שהפעילות הופסקה',
    });
  } else {
    clears.push({ category: 'הימורים', title: 'לא זוהתה פעילות הימורים', detail: 'דפי העו"ש נקיים מעסקאות הימורים' });
  }

  // קריפטו
  const hasCrypto = riskRadar.some(r =>
    CRYPTO_KEYWORDS.some(kw => (r.finding || '').toLowerCase().includes(kw.toLowerCase()))
  ) || result?.crypto_detected;
  if (hasCrypto) {
    warnings.push({
      severity: 'warning',
      category: 'פעילות קריפטו',
      icon: '🟡',
      title: 'פעילות קריפטו זוהתה',
      detail: 'עסקאות עם בורסות קריפטו מזוהות בדפי העו"ש — חלק מהבנקים רואים בכך סיכון',
      action: 'מומלץ לצרף הסבר כתוב ולוודא שמדובר בהשקעה לגיטימית בלבד',
    });
  } else {
    clears.push({ category: 'קריפטו', title: 'לא זוהתה פעילות קריפטו', detail: 'אין עסקאות עם בורסות קריפטו' });
  }

  // === שכבה 3.5: העברות הון זרות חריגות (תיק ילנה) ===
  // העברות גדולות ללא סיווג הכנסה/חובה ברור (כמו 200k מסיטיבנק, 644k העברה בנקאית).
  // הגנות null מלאות — גם אם השדה חסר חלקית, הסריקה לא קורסת והאזהרה כן מוצגת.
  const equityEvents = Array.isArray(result?.equity_events) ? result.equity_events : [];
  const foreignDetected = !!result?.foreign_transfers_detected || equityEvents.length > 0;
  if (foreignDetected) {
    // סנן רק אירועים בעלי סכום משמעותי (מעל 50k) — אלה הדורשים מקור הון מוסבר
    const bigTransfers = equityEvents.filter(e => Number(e?.amount) >= 50000);
    const totalForeign = equityEvents.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
    const detailList = (bigTransfers.length > 0 ? bigTransfers : equityEvents)
      .slice(0, 4)
      .map(e => {
        const amt = Number(e?.amount) || 0;
        const desc = e?.description || e?.source || 'העברה';
        const date = e?.date ? ` (${e.date})` : '';
        return `${desc}${date}: ₪${amt.toLocaleString('he-IL')}`;
      })
      .join(' · ');
    warnings.push({
      severity: 'warning',
      category: 'מקור הון — העברה זרה',
      icon: '🟡',
      title: 'העברה זרה חריגה — נדרש מקור הון מוסבר',
      detail: detailList
        ? `זוהו העברות הון גדולות ללא סיווג הכנסה/חובה: ${detailList}${totalForeign > 0 ? ` | סה"כ: ₪${totalForeign.toLocaleString('he-IL')}` : ''}`
        : 'זוהו העברות הון זרות חריגות בעו"ש ללא סיווג ברור.',
      action: 'יש לבקש מהלקוח אסמכתה למקור ההון (העברה לחו"ל, מתנה, מימוש נכס) — הבנק ידרוש הסבר AML מלא.',
    });
  } else {
    clears.push({ category: 'מקור הון', title: 'לא זוהו העברות זרות חריגות', detail: 'אין העברות הון גדולות ללא סיווג בעו"ש' });
  }

  // הוצאות כרטיס אשראי מול הכנסה
  const highCreditCards = riskRadar.filter(r =>
    (r.finding || '').includes('כרטיס') && (r.severity === 'HIGH' || r.severity === 'MEDIUM')
  );
  if (highCreditCards.length > 0) {
    warnings.push({
      severity: 'warning',
      category: 'כרטיסי אשראי',
      icon: '🟡',
      title: 'הוצאות אשראי חריגות',
      detail: highCreditCards[0].finding,
      action: 'יש לבדוק אם ממוצע 3 חודשים תואם להכנסה — חריגה מעל 25% מהכנסה נטו היא דגל אדום',
    });
  }

  // מינוס כרוני
  const hasChronicOverdraft = riskRadar.some(r =>
    (r.finding || '').includes('מינוס כרוני') || (r.finding || '').includes('overdraft')
  );
  if (hasChronicOverdraft) {
    warnings.push({
      severity: 'warning',
      category: 'ניהול תזרים',
      icon: '🟡',
      title: 'מינוס כרוני בחשבון',
      detail: 'החשבון מצוי במינוס ברציפות — מעיד על קושי בניהול תזרים',
      action: 'יש לבקש מהלקוח הסבר ואולי להציג 3 חודשי עו"ש נוספים',
    });
  }

  // PTI — בתיק מחזור: השתמש ב-pti_consumer (ללא המשכנתא הקיימת שנסגרת)
  // בתיקים אחרים: pti_ratio הוא הנכון
  const isRefinanceCase = (result?.detected_case_types || []).some(t =>
    t.includes('מחזור') || t.includes('מיחזור')
  );
  // pti_consumer = PTI ללא המשכנתא הקיימת (רק הלוואות צרכניות)
  // pti_ratio = PTI כולל הכל (כולל המשכנתא הקיימת)
  // בתיק מחזור: הסרת המשכנתא הקיימת מהחישוב כי היא נסגרת
  const pti = isRefinanceCase
    ? (b.pti_consumer ?? b.pti_ratio ?? 0)
    : (b.pti_ratio ?? 0);

  if (pti > 50) {
    flags.push({
      severity: 'critical',
      category: 'כושר החזר',
      icon: '🔴',
      title: `PTI גבוה קריטי — ${pti.toFixed(1)}%`,
      detail: `יחס ההחזר הנוכחי חורג מ-50% — גבול קשה של מרבית הבנקים בישראל`,
      action: 'נדרש מחזור / איחוד חובות או הגדלת הכנסה לפני הגשה',
    });
  } else if (pti > 40) {
    warnings.push({
      severity: 'warning',
      category: 'כושר החזר',
      icon: '🟡',
      title: `PTI גבוה — ${pti.toFixed(1)}%`,
      detail: `יחס ההחזר חורג מ-40% — אזור הסיכון של הבנקים`,
      action: 'ניתן לנסות בבנקים מסוימים, אך מומלץ לשפר קודם',
    });
  } else if (pti > 0) {
    clears.push({ category: 'PTI', title: `PTI תקין — ${pti.toFixed(1)}%`, detail: 'יחס ההחזר בטווח המקובל בבנקים' });
  }

  // === Go / No-Go ===
  const hasBlockers = flags.length > 0;
  const hasWarnings = warnings.length > 0;
  const verdict = hasBlockers ? 'no_go' : hasWarnings ? 'caution' : 'go';

  return { flags, warnings, clears, verdict };
}

// ── כרטיס פריט ──
function AnomalyItem({ item, isClear }) {
  if (isClear) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 12px', background: '#f0fdf4',
        border: '1px solid #bbf7d0', borderRadius: '8px',
      }}>
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: '#16a34a' }} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#166534' }}>{item.title}</span>
        <span style={{ fontSize: '10px', color: '#4ade80', marginRight: 'auto' }}>{item.detail}</span>
      </div>
    );
  }

  const isCritical = item.severity === 'critical';
  return (
    <div style={{
      background: isCritical ? '#fff5f5' : '#fffbeb',
      border: `1px solid ${isCritical ? '#fecaca' : '#fde68a'}`,
      borderRight: `4px solid ${isCritical ? '#dc2626' : '#f59e0b'}`,
      borderRadius: '10px',
      padding: '11px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        {isCritical
          ? <XCircle className="w-4 h-4 shrink-0" style={{ color: '#dc2626' }} />
          : <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#d97706' }} />
        }
        <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{item.title}</span>
        <span style={{
          marginRight: 'auto', fontSize: '9px', fontWeight: 700,
          background: isCritical ? '#dc2626' : '#d97706', color: 'white',
          borderRadius: '20px', padding: '2px 8px',
        }}>{item.category}</span>
      </div>
      {item.detail && (
        <p style={{ fontSize: '11px', color: '#475569', marginBottom: '6px', lineHeight: 1.5 }}>{item.detail}</p>
      )}
      {item.action && (
        <div style={{
          background: 'white', border: `1px solid ${isCritical ? '#fca5a5' : '#fde68a'}`,
          borderRadius: '6px', padding: '6px 10px',
          fontSize: '10px', color: '#374151', fontWeight: 600,
        }}>
          💡 {item.action}
        </div>
      )}
    </div>
  );
}

// ── Verdict Banner ──
function VerdictBanner({ verdict, flagCount, warningCount }) {
  const config = {
    go: {
      bg: 'linear-gradient(135deg, #14532d, #166534)',
      border: '#16a34a',
      icon: <ShieldCheck className="w-7 h-7" style={{ color: '#4ade80' }} />,
      badge: '✅ GO',
      badgeBg: '#16a34a',
      title: 'תיק נקי — Go לחיתום',
      sub: 'לא זוהו דגלים אדומים. התיק מוכן להגשה לבנקים.',
    },
    caution: {
      bg: 'linear-gradient(135deg, #78350f, #92400e)',
      border: '#d97706',
      icon: <ShieldAlert className="w-7 h-7" style={{ color: '#fbbf24' }} />,
      badge: '⚠️ CAUTION',
      badgeBg: '#d97706',
      title: `${warningCount} אזהרות — דרוש בירור`,
      sub: 'אין חוסמים קריטיים אך יש נקודות שדורשות הסבר לפני הגשה.',
    },
    no_go: {
      bg: 'linear-gradient(135deg, #450a0a, #7f1d1d)',
      border: '#dc2626',
      icon: <ShieldX className="w-7 h-7" style={{ color: '#f87171' }} />,
      badge: '🔴 NO-GO',
      badgeBg: '#dc2626',
      title: `${flagCount} דגלים קריטיים — עצור`,
      sub: 'זוהו חוסמים שעלולים לגרום לדחייה. יש לטפל לפני המשך.',
    },
  };
  const c = config[verdict];
  return (
    <div style={{
      background: c.bg,
      border: `2px solid ${c.border}`,
      borderRadius: '14px',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      marginBottom: '14px',
    }}>
      {c.icon}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span style={{
            background: c.badgeBg, color: 'white', fontWeight: 900, fontSize: '11px',
            borderRadius: '6px', padding: '2px 10px', letterSpacing: '1px',
          }}>{c.badge}</span>
          <span style={{ color: 'white', fontWeight: 800, fontSize: '15px' }}>{c.title}</span>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', margin: 0 }}>{c.sub}</p>
      </div>
    </div>
  );
}

// ── ראשי ──
export default function AnomalyShield({ result }) {
  const [expanded, setExpanded] = useState(true);
  const [showClears, setShowClears] = useState(false);

  // ── Early Return מוקדם: לפני ה-useMemo, כדי ש-detectAnomalies לא ירוץ על result פגום ──
  const hasValidData = result && typeof result === 'object' && result.borrower_info;

  const { flags, warnings, clears, verdict } = useMemo(
    () => hasValidData ? detectAnomalies(result) : { flags: [], warnings: [], clears: [], verdict: 'go' },
    [result, hasValidData]
  );

  if (!hasValidData) return null;

  const totalIssues = flags.length + warnings.length;

  return (
    <div style={{
      background: 'white',
      border: '2px solid #e2e8f0',
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%',
          background: verdict === 'no_go'
            ? 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)'
            : verdict === 'caution'
            ? 'linear-gradient(135deg, #1c1400 0%, #2d2000 100%)'
            : 'linear-gradient(135deg, #052e16 0%, #14532d 100%)',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          border: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px'
          }}>🛡️</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'white', fontWeight: 800, fontSize: '14px' }}>
              שלב 4 — Anomaly Shield (סורק המוקשים)
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginTop: '1px' }}>
              סריקה דטרמיניסטית: BDI · חובות צל · התנהגות פיננסית
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {flags.length > 0 && (
            <span style={{ background: '#dc2626', color: 'white', fontWeight: 900, fontSize: '11px', borderRadius: '20px', padding: '3px 10px' }}>
              {flags.length} קריטי
            </span>
          )}
          {warnings.length > 0 && (
            <span style={{ background: '#d97706', color: 'white', fontWeight: 900, fontSize: '11px', borderRadius: '20px', padding: '3px 10px' }}>
              {warnings.length} אזהרה
            </span>
          )}
          {totalIssues === 0 && (
            <span style={{ background: '#16a34a', color: 'white', fontWeight: 900, fontSize: '11px', borderRadius: '20px', padding: '3px 10px' }}>
              נקי ✓
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-white opacity-60" />
            : <ChevronDown className="w-4 h-4 text-white opacity-60" />
          }
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '16px 20px' }}>
          {/* Verdict */}
          <VerdictBanner verdict={verdict} flagCount={flags.length} warningCount={warnings.length} />

          {/* Critical flags */}
          {flags.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <XCircle className="w-3.5 h-3.5" />
                דגלים קריטיים — עוצרים עסקה ({flags.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {flags.map((f, i) => <AnomalyItem key={i} item={f} />)}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#d97706', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle className="w-3.5 h-3.5" />
                אזהרות — דורשות בירור ({warnings.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {warnings.map((w, i) => <AnomalyItem key={i} item={w} />)}
              </div>
            </div>
          )}

          {/* Clears (collapsible) */}
          {clears.length > 0 && (
            <div>
              <button
                onClick={() => setShowClears(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '11px', fontWeight: 700, color: '#16a34a',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: '6px'
                }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {clears.length} בדיקות עברו ✓
                {showClears ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showClears && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {clears.map((c, i) => <AnomalyItem key={i} item={c} isClear />)}
                </div>
              )}
            </div>
          )}

          {/* Info note */}
          <div style={{
            marginTop: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px',
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px',
          }}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <p style={{ fontSize: '10px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              הסריקה מבוססת על הנתונים שנמצאו במסמכים שהועלו. לבדיקה מעמיקה יש להעלות דפי עו"ש מלאים (3 חודשים) ולאמת מול דוחות BDI מהבנק.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}