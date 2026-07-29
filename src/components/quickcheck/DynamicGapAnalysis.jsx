import React, { useMemo } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

/**
 * DynamicGapAnalysis — שלב 3: ניתוח חוסרים דינמי מותאם אישית
 *
 * מקבל:
 *   result        — פלט buildQuickReport (אחרי ניתוח מלא)
 *   preScanResult — פלט preScanDocuments (אם קיים)
 *   reportType    — סוג העסקה שנבחר
 *
 * מחזיר רשימת השלמות מדויקת עם 3 סטטוסים:
 *   ✅ התקבל  |  ❌ חסר  |  ⚠️ חלקי
 */

// ── סטטוס צבעים ──
const STATUS = {
  ok:      { icon: CheckCircle2, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'התקבל' },
  missing: { icon: XCircle,      color: '#dc2626', bg: '#fff5f5', border: '#fecaca', label: 'חסר' },
  partial: { icon: AlertTriangle, color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'חלקי' },
};

// ── פונקציית החישוב המרכזית ──
export function computeGapItems(result, preScanResult, reportType) {
  const b = result?.borrower_info || {};
  const scan = preScanResult || {};
  const detectedTypes = result?.detected_case_types || scan.detected_case_types || [];

  const isRefinance = reportType?.includes('מחזור') || reportType?.includes('מיחזור') ||
    detectedTypes.some(t => t.includes('מחזור') || t.includes('מיחזור'));
  const isConsolidation = reportType?.includes('איחוד') || detectedTypes.some(t => t.includes('איחוד'));
  const isPurchase = reportType?.includes('רכישת נכס') || detectedTypes.some(t => t.includes('רכישת נכס'));
  const isBusinessCase = detectedTypes.some(t => t.includes('בעלי עסקים') || t.includes('עצמאי'));
  // לווה 1 עצמאי: אם employment_type מכיל "עצמאי" OR אם התיק הוא עסקי וה-income_months הראשון הוא "עצמאי"
  const b1IncomeIsFromBusiness = result?.income_months?.some(m => 
    (m.month || '').includes('עצמאי') || (m.month || '').includes('ממוצע שנות מס') || 
    (m.note || '').includes('הכנסה מעסק') || (m.note || '').includes('CPA Override') ||
    (m.note || '').includes('מכתב רו"ח')
  );
  const isSelfEmployed1 = (b.employment_type || '').includes('עצמאי') || 
    (isBusinessCase && b1IncomeIsFromBusiness && !b.employer) ||
    (isBusinessCase && b1IncomeIsFromBusiness);
  const isSelfEmployed2 = (b.employment_type_2 || '').includes('עצמאי');
  const isSabbatical1 = (b.employment_type || '').includes('שבתון') || (b.employment_type || '').includes('חופשת לידה') || (b.employment_type || '').includes('חל"ת');
  const isSabbatical2 = (b.employment_type_2 || '').includes('שבתון') || (b.employment_type_2 || '').includes('חופשת לידה') || (b.employment_type_2 || '').includes('חל"ת');

  // ── נתח כמה תלושי שכר יש לכל לווה ──
  const payslipsB1 = result?._rawPayslipsCountB1 ?? scan.payslip_count_b1 ?? null;
  const payslipsB2 = result?._rawPayslipsCountB2 ?? scan.payslip_count_b2 ?? null;

  // fallback: מהמסמכים החסרים של buildQuickReport
  const missingDocs = result?.missing_docs || [];
  // ══ FIX: אל תסמן תלושים כחסרים לעצמאי שיש לו הכנסה (income_months מציג "עצמאי") ══
  const hasBusinessIncomeMonths = result?.income_months?.some(m =>
    (m.month || '').includes('עצמאי') || (m.month || '').includes('ממוצע שנות מס') ||
    (m.note || '').includes('הכנסה מעסק') || (m.note || '').includes('CPA Override') ||
    (m.note || '').includes('מכתב רו"ח')
  );
  const hasMissingPayslipB1 = !hasBusinessIncomeMonths && missingDocs.some(d => /תלוש.*שכר.*1|לווה.*1.*תלוש/.test(d) || (d.includes('תלוש שכר') && !d.includes('לווה 2')));
  const hasMissingPayslipB2 = missingDocs.some(d => /תלוש.*שכר.*2|לווה.*2.*תלוש/.test(d));
  const hasMissingMortgageStatement = missingDocs.some(d => d.includes('יתרת') || d.includes('סילוק'));
  const hasMissingCPALetter = missingDocs.some(d => d.includes('רו"ח') || d.includes('רואה חשבון') || d.includes('מכתב'));
  const hasMissingTaxReport = missingDocs.some(d => d.includes('שומה') || d.includes('מס'));
  const hasMissingId = missingDocs.some(d => d.includes('זהות') || d.includes('ת.ז'));
  const hasMissingReturnToWork = missingDocs.some(d => d.includes('חזרה') || d.includes('שבתון'));

  // ── ת.ז לווים — בדיקה כפולה: (1) קיום מספר ת.ז, (2) קיום מסמך פיזי ──
  // ===true, not !==false — a missing/undefined value must never read as "verified" (same rule
  // applied in normalizeDocData/buildQuickReport/buildUnderwriterReport/mergeExtractedDocuments).
  const hasIdNumber1 = !!(b.id && String(b.id).replace(/\D/g, '').length === 9);
  const hasIdDocument1 = result?.borrower_id_document_found?.b1 === true;
  const hasId1 = hasIdNumber1 && hasIdDocument1;

  const hasIdNumber2 = b.name_2 ? !!(b.id_2 && String(b.id_2).replace(/\D/g, '').length === 9) : null;
  const hasIdDocument2 = b.name_2 ? (result?.borrower_id_document_found?.b2 === true) : null;
  const hasId2 = b.name_2 ? (hasIdNumber2 && hasIdDocument2) : null;

  // ── הכנסה ──
  const hasIncome1 = (b.avg_income || 0) > 0;
  const hasIncome2 = b.name_2 ? (b.avg_income_2 || 0) > 0 : null;

  // ── משכנתא קיימת ──
  const hasMortgageBalance = !!(result?.existing_mortgage?.remaining_balance);
  const hasMortgagePayment = !!(result?.existing_mortgage?.monthly_payment);

  // ── שדות מה-preScan ──
  const scanFound = scan.found_documents || [];
  const hasBankStatement = scanFound.some(d => d.type === 'bank_statement' || d.category === 'bank_statement') ||
    (result?.borrower_info?.monthly_net_cashflow != null);
  const bankStatementMonths = scan.bank_statement_months_count ?? null;

  const items = [];

  // ────────────────────────────────
  // 1. זהות — תמיד נדרש
  // ────────────────────────────────
  // לווה 1 — ת.ז
  const id1Status = !hasIdNumber1 ? 'missing' : !hasIdDocument1 ? 'partial' : 'ok';
  const id1Detail = !hasIdNumber1
    ? 'לא נמצא מספר ת.ז בשום מסמך שהועלה'
    : !hasIdDocument1
      ? `מספר ת.ז זוהה (${String(b.id).slice(0,3)}****) אך לא הועלה מסמך תעודת זהות ייעודי — נדרש להעלות ת.ז / ספח ביומטרי`
      : `ת.ז ${String(b.id).slice(0, 3)}**** — מסמך פיזי אומת ✓`;
  items.push({
    category: 'זהות',
    label: `תעודת זהות${b.name ? ` — ${b.name}` : ' לווה ראשי'}`,
    status: id1Status,
    detail: id1Detail,
    reason: id1Status === 'partial' ? 'מספר ת.ז אוזכר במסמך אחר — אין תחליף למסמך הייעודי' : null,
    priority: id1Status === 'missing' ? 'critical' : null,
  });

  if (b.name_2 && hasIdNumber2 !== null) {
    const id2Status = !hasIdNumber2 ? 'missing' : !hasIdDocument2 ? 'partial' : 'ok';
    const id2Detail = !hasIdNumber2
      ? 'לא נמצא מספר ת.ז עבור הלווה השני'
      : !hasIdDocument2
        ? `מספר ת.ז זוהה (${String(b.id_2).slice(0,3)}****) אך לא הועלה מסמך תעודת זהות ייעודי — נדרש להעלות ת.ז / ספח ביומטרי`
        : `ת.ז ${String(b.id_2).slice(0, 3)}**** — מסמך פיזי אומת ✓`;
    items.push({
      category: 'זהות',
      label: `תעודת זהות — ${b.name_2}`,
      status: id2Status,
      detail: id2Detail,
      reason: id2Status === 'partial' ? 'מספר ת.ז אוזכר במסמך אחר (ספח של הלווה הראשי, תלוש, וכד\'). הבנק דורש מסמך ת.ז. ייעודי לכל לווה.' : null,
      priority: id2Status === 'missing' ? 'critical' : null,
    });
  }

  // ────────────────────────────────
  // 2. תלושי שכר — לפי פרופיל
  // ────────────────────────────────
  if (!isSelfEmployed1) {
    if (isSabbatical1) {
      items.push({
        category: 'הכנסה',
        label: `מכתב חזרה לעבודה${b.name ? ` — ${b.name}` : ''}`,
        status: hasMissingReturnToWork ? 'missing' : hasIncome1 ? 'ok' : 'missing',
        detail: hasIncome1 ? 'זוהה — שימש לחישוב נרמול הכנסה' : 'חובה לאימות הכנסה לאחר תום השבתון / חופשת הלידה',
        reason: 'נדרש לאישור הבנק לחישוב ההכנסה לאחר החזרה',
      });
    } else {
      const p1Status = hasMissingPayslipB1 ? 'missing' : hasIncome1 ? (payslipsB1 !== null && payslipsB1 < 3 ? 'partial' : 'ok') : 'missing';
      const p1Detail = hasIncome1
        ? (payslipsB1 !== null ? `נמצאו ${payslipsB1} חודשים — ${payslipsB1 < 3 ? 'חסר חודש שלישי (הבנקים דורשים מינימום 3)' : 'תקין'}` : 'תלושי שכר זוהו')
        : 'לא נמצאו תלושי שכר — הכנסה לא חושבה';
      items.push({
        category: 'הכנסה',
        label: `תלושי שכר (3 חודשים)${b.name ? ` — ${b.name}` : ''}`,
        status: p1Status,
        detail: p1Detail,
        reason: payslipsB1 !== null && payslipsB1 < 3 ? `קיימים ${payslipsB1} מתוך 3 חודשים נדרשים` : null,
      });
    }
  } else {
    // עצמאי
    const hasTaxReport = !hasMissingTaxReport && hasIncome1;
    const hasCPA = !hasMissingCPALetter && hasIncome1;
    items.push({
      category: 'הכנסה (עצמאי)',
      label: `שומת מס${b.name ? ` — ${b.name}` : ''} (2 שנים אחרונות)`,
      status: hasTaxReport ? 'ok' : 'missing',
      detail: hasTaxReport ? 'שומת מס זוהתה ושימשה לחישוב הכנסה' : 'עצמאי — נדרשות שומות מס 2 שנים אחרונות',
      reason: 'במקום תלושי שכר — עצמאי מציג שומות מס',
    });
    items.push({
      category: 'הכנסה (עצמאי)',
      label: `מכתב רואה חשבון${b.name ? ` — ${b.name}` : ''}`,
      status: hasCPA ? 'ok' : hasTaxReport ? 'partial' : 'missing',
      detail: hasCPA ? 'מכתב רו"ח זוהה' : 'מכתב רו"ח מוסמך המאשר הכנסה חודשית ממוצעת — מחזק משמעותית את בקשת ההלוואה',
      reason: 'מומלץ מאוד — מעלה את רמת האמינות בעיני הבנק',
    });
  }

  if (b.name_2 && hasIncome2 !== null) {
    if (!isSelfEmployed2) {
      if (isSabbatical2) {
        // מכתב חזרה לעבודה: הסטטוס נקבע לפי קיום המכתב — לא לפי קיום הכנסה (יכולה להגיע ממענק שבתון)
        items.push({
          category: 'הכנסה',
          label: `מכתב חזרה לעבודה — ${b.name_2}`,
          status: hasMissingReturnToWork ? 'missing' : 'ok',
          detail: !hasMissingReturnToWork ? 'זוהה ושימש לחישוב נרמול' : 'חובה עבור הלווה השני שבשבתון/חל"ת — ללא מכתב הכנסה = 0 בחיתום הבנקאי',
        });
      } else {
        const p2Status = hasMissingPayslipB2 ? 'missing' : hasIncome2 ? (payslipsB2 !== null && payslipsB2 < 3 ? 'partial' : 'ok') : 'missing';
        items.push({
          category: 'הכנסה',
          label: `תלושי שכר (3 חודשים) — ${b.name_2}`,
          status: p2Status,
          detail: hasIncome2
            ? (payslipsB2 !== null ? `נמצאו ${payslipsB2} חודשים — ${payslipsB2 < 3 ? 'חסר חודש' : 'תקין'}` : 'תלושי שכר זוהו')
            : 'לא נמצאו תלושי שכר עבור הלווה השני',
          reason: payslipsB2 !== null && payslipsB2 < 3 ? `קיימים ${payslipsB2} מתוך 3 חודשים נדרשים` : null,
        });
      }
    } else {
      items.push({
        category: 'הכנסה (עצמאי)',
        label: `שומות מס + מכתב רו"ח — ${b.name_2}`,
        status: hasIncome2 ? 'ok' : 'missing',
        detail: hasIncome2 ? 'נתוני עסק זוהו' : 'עצמאי — נדרשות שומות מס 2 שנים + מכתב רו"ח',
      });
    }
  }

  // ────────────────────────────────
  // 3. דפי חשבון בנק
  // ────────────────────────────────
  const bankStatus = !hasBankStatement ? 'missing' : (bankStatementMonths !== null && bankStatementMonths < 3) ? 'partial' : 'ok';
  const bankDetail = !hasBankStatement
    ? 'לא נמצאו דפי עו"ש — נדרשים 3 חודשים אחרונים'
    : bankStatementMonths !== null
      ? `נמצאו ${bankStatementMonths} חודשים — ${bankStatementMonths < 3 ? `חסר ${3 - bankStatementMonths} חודש נוסף` : 'תקין'}`
      : 'דפי חשבון זוהו';
  items.push({
    category: 'בנק',
    label: 'דפי עו"ש (3 חודשים אחרונים)',
    status: bankStatus,
    detail: bankDetail,
    reason: bankStatus === 'partial' ? `קיימים ${bankStatementMonths} מתוך 3 חודשים נדרשים` : null,
  });

  // ────────────────────────────────
  // 4. ספציפי לעסקה
  // ────────────────────────────────
  if (isRefinance || isConsolidation) {
    // דו"ח יתרות סילוק
    const mortgageStatementStatus = hasMissingMortgageStatement ? 'missing' : hasMortgageBalance ? 'ok' : 'missing';
    items.push({
      category: 'מחזור / יתרת משכנתא',
      label: 'דו"ח יתרות סילוק מעודכן',
      status: mortgageStatementStatus,
      detail: hasMortgageBalance
        ? `יתרת סילוק: ₪${result.existing_mortgage.remaining_balance.toLocaleString()} — ${hasMortgagePayment ? `החזר חודשי: ₪${result.existing_mortgage.monthly_payment.toLocaleString()}` : 'החזר חודשי לא זוהה'}`
        : 'חסר — נדרש לחישוב LTV מדויק ועמלת פירעון מוקדם',
      reason: !hasMortgageBalance ? 'ללא דו"ח יתרות סילוק לא ניתן לחשב את יתרת הקרן המדויקת' : null,
      priority: !hasMortgageBalance ? 'critical' : null,
    });

    if (!hasMortgagePayment && hasMortgageBalance) {
      items.push({
        category: 'מחזור / יתרת משכנתא',
        label: 'החזר חודשי נוכחי',
        status: 'partial',
        detail: 'יתרת סילוק זוהתה אך ההחזר החודשי לא חושב — ייתכן שהדו"ח לא כלל את פירוט המסלולים',
        reason: 'נדרש לחישוב פוטנציאל החיסכון החודשי',
      });
    }
  }

  if (isPurchase) {
    const hasPurchaseContract = scanFound.some(d => d.type === 'purchase_contract' || d.category === 'purchase_contract') ||
      !!(result?.existing_mortgage?.statement_date);
    items.push({
      category: 'רכישה',
      label: 'חוזה רכישה / אישור עקרוני מהבנק',
      status: hasPurchaseContract ? 'ok' : 'missing',
      detail: hasPurchaseContract ? 'זוהה' : 'נדרש לאימות שווי הנכס ועלות הרכישה המוסכמת',
      reason: 'הבנקים דורשים חוזה חתום לפני אישור סופי',
    });
  }

  // ────────────────────────────────
  // 5. ציון A+ — מה עוד חסר?
  // ────────────────────────────────
  // קרן השתלמות / פנסיה — רלוונטי רק לתיקי רכישה, לא למחזור
  // בתיק מחזור: הנכס כבר בבעלות הלווה, אין דרישה לנזילות כהון עצמי
  if (!isRefinance && !isConsolidation) {
    const hasLiquidAssets =
      (result?.total_equity_evidence || 0) > 0 ||
      (result?.liquid_assets_total || 0) > 0 ||
      (result?.strengths || []).some(s =>
        s.includes('קרן השתלמות') || s.includes('נזיל') || s.includes('גורם מפצה') || s.includes('הון נזיל')
      ) ||
      (result?.bankerLetter || '').includes('הון נזיל') ||
      (result?.executive_summary || '').includes('הון נזיל');
    if (!hasLiquidAssets) {
      items.push({
        category: 'חוזקות נוספות',
        label: 'הצהרת קרן השתלמות / פנסיה נזילה',
        status: 'missing',
        detail: 'לא זוהו נכסים נזילים — הצגת קרן השתלמות / קרן פנסיה נזילה מעלה משמעותית את ציון החיתום',
        reason: 'מגדיל כרית ביטחון בעיני הבנק ועשוי לשפר את הריבית המוצעת',
      });
    }
  }

  return items;
}

// ── חישוב סיכום ──
export function computeSummary(items) {
  const ok = items.filter(i => i.status === 'ok').length;
  const missing = items.filter(i => i.status === 'missing').length;
  const partial = items.filter(i => i.status === 'partial').length;
  const total = items.length;
  const score = Math.round((ok + partial * 0.5) / total * 100);
  return { ok, missing, partial, total, score };
}

// ── קבוצת פריטים ──
function GapGroup({ category, items }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
      >
        <span className="text-xs font-black text-slate-600 uppercase tracking-wider">{category}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{items.length} פריטים</span>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 px-1">
          {items.map((item, i) => {
            const s = STATUS[item.status];
            const Icon = s.icon;
            return (
              <div
                key={i}
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  borderRight: item.priority === 'critical' ? `4px solid #dc2626` : `3px solid ${s.color}`,
                  borderRadius: '10px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: s.color }} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '2px' }}>
                    {item.label}
                    {item.priority === 'critical' && (
                      <span style={{ fontSize: '10px', background: '#dc2626', color: 'white', borderRadius: '4px', padding: '1px 6px', marginRight: '6px', fontWeight: 800 }}>
                        קריטי
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.5 }}>{item.detail}</div>
                  {item.reason && (
                    <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', fontStyle: 'italic' }}>
                      💡 {item.reason}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: '10px', fontWeight: 700, color: s.color, background: 'white',
                  border: `1px solid ${s.border}`, borderRadius: '20px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0
                }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── הרכיב הראשי ──
export default function DynamicGapAnalysis({ result, preScanResult, reportType }) {
  const [expanded, setExpanded] = useState(true);

  const items = useMemo(
    () => computeGapItems(result, preScanResult, reportType),
    [result, preScanResult, reportType]
  );

  const summary = useMemo(() => computeSummary(items), [items]);

  // קיבוץ לפי קטגוריה
  const grouped = useMemo(() => {
    const map = {};
    items.forEach(item => {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    });
    return map;
  }, [items]);

  const scoreColor = summary.score >= 85 ? '#16a34a' : summary.score >= 60 ? '#d97706' : '#dc2626';
  const scoreLabel = summary.score >= 85 ? 'תיק כמעט מוכן לחיתום' : summary.score >= 60 ? 'נדרשים השלמות לפני הגשה' : 'תיק דורש השלמות מהותיות';

  if (items.length === 0) return null;

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
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
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
            background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px'
          }}>🎯</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'white', fontWeight: 800, fontSize: '14px', letterSpacing: '0.3px' }}>
              שלב 3 — ניתוח חוסרים דינמי
            </div>
            <div style={{ color: '#8892B0', fontSize: '11px', marginTop: '1px' }}>
              רשימת השלמות מותאמת אישית לפי פרופיל הלווה וסוג העסקה
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Score pill */}
          <div style={{
            background: 'rgba(255,255,255,0.08)',
            border: `1px solid ${scoreColor}50`,
            borderRadius: '20px',
            padding: '4px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ fontSize: '18px', fontWeight: 900, color: scoreColor }}>{summary.score}%</span>
            <span style={{ fontSize: '10px', color: '#8892B0' }}>{scoreLabel}</span>
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-400" />
            : <ChevronDown className="w-4 h-4 text-slate-400" />
          }
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '16px 20px' }}>
          {/* Summary bar */}
          <div style={{
            display: 'flex', gap: '10px', marginBottom: '16px',
            background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: '12px', padding: '12px 16px',
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: '#16a34a' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#166534' }}>{summary.ok} התקבלו</span>
            </div>
            <div style={{ color: '#e2e8f0', fontSize: '14px' }}>|</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle className="w-4 h-4" style={{ color: '#d97706' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#92400e' }}>{summary.partial} חלקיים</span>
            </div>
            <div style={{ color: '#e2e8f0', fontSize: '14px' }}>|</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <XCircle className="w-4 h-4" style={{ color: '#dc2626' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b' }}>{summary.missing} חסרים</span>
            </div>
            {/* Progress bar */}
            <div style={{ flex: 1, minWidth: '120px', display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
              <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: '99px',
                  background: `linear-gradient(90deg, ${scoreColor}, ${scoreColor}cc)`,
                  width: `${summary.score}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <span style={{ fontSize: '11px', fontWeight: 800, color: scoreColor }}>{summary.score}%</span>
            </div>
          </div>

          {/* Groups */}
          {Object.entries(grouped).map(([category, groupItems]) => (
            <GapGroup key={category} category={category} items={groupItems} />
          ))}

          {/* Footer tip */}
          {summary.missing > 0 && (
            <div style={{
              marginTop: '12px', background: '#fef9c3', border: '1px solid #fde047',
              borderRadius: '10px', padding: '10px 14px', fontSize: '11px', color: '#713f12', fontWeight: 600
            }}>
              💡 <strong>כדי להגיע לציון A+ בחיתום:</strong> השלם את {summary.missing + summary.partial} הפריטים שמסומנים כחסרים או חלקיים — ואז הפק דוח מלא מחודש.
            </div>
          )}
          {summary.missing === 0 && summary.partial === 0 && (
            <div style={{
              marginTop: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '10px', padding: '10px 14px', fontSize: '11px', color: '#166534', fontWeight: 700
            }}>
              ✅ כל המסמכים הנדרשים התקבלו — התיק מוכן לחיתום מוסדי!
            </div>
          )}
        </div>
      )}
    </div>
  );
}