import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, ArrowLeft, Zap, FolderArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import OpportunityHook from './OpportunityHook';
import DynamicGapAnalysis from './DynamicGapAnalysis';
import AnomalyShield from './AnomalyShield';
import ErrorMessage from './ErrorMessage';

// ── Dark theme palette ────────────────────────────────────────────────────────
const D = {
  bg: '#060b14', card: '#0d1524', border: '#1e2d4a',
  gold: '#C5A059', goldText: '#D4AF37',
  text: '#e2e8f0', muted: '#8892B0', dim: '#4a5568',
  green: '#4ade80', greenBg: '#0D3D2B', greenBorder: '#22c55e44',
  yellow: '#facc15', yellowBg: '#2D2800', yellowBorder: '#facc1544',
  red: '#f87171', redBg: '#3D0000', redBorder: '#ef444444',
  blue: '#60a5fa', blueBg: '#0d2040', blueBorder: '#1e3a6a44',
};

function ptiColor(pti) {
  return pti < 30 ? D.green : pti < 40 ? D.yellow : D.red;
}

function computeOpportunityHook(result) {
  if (result.opportunity_hook) return result.opportunity_hook;
  const b = result.borrower_info || {};
  const mortgage = result.existing_mortgage;
  if (!mortgage?.remaining_balance || !mortgage?.monthly_payment) return null;
  const detectedTypes = result.detected_case_types || [];
  const isRefi = detectedTypes.some(t => t.includes('מחזור') || t.includes('מיחזור'));
  if (!isRefi) return null;
  const income = b.total_household_income || b.avg_income || 0;
  if (income < 100) return null;
  const mortgageBalance = mortgage.remaining_balance;
  if (mortgageBalance < 50000) return null;
  const currentMortgagePayment = mortgage.monthly_payment;
  const r = 0.04 / 12; const n = 240;
  const est = Math.round(mortgageBalance * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  const savings = Math.max(0, currentMortgagePayment - est);
  if (savings <= 50) return null;
  return {
    is_relevant: true, label: 'פוטנציאל מיחזור משכנתא',
    current_monthly_total: currentMortgagePayment, estimated_new_payment: est,
    monthly_savings: Math.round(savings),
    pti_before: income > 0 ? parseFloat(((currentMortgagePayment / income) * 100).toFixed(1)) : 0,
    pti_after: income > 0 ? parseFloat(((est / income) * 100).toFixed(1)) : 0,
    total_income: income,
  };
}

const BDI_NOGO_KEYWORDS = [
  "אכ\"מ", 'אכמ', 'אי כיבוד', 'אי-כיבוד', 'יתרה בלתי מספקת',
  'חזרת שיק', "חזרת צ'ק", 'הוראה לא כובדה', 'חזרת הוראה',
  'returned', 'bounced', 'nsf', 'dishonored',
  'הגבלה', 'מוגבל', 'הוצאה לפועל', 'עיקול', 'אי כיסוי', 'סורב',
];
function isNoGo(result) {
  if (!result?.risk_radar) return false;
  const hasBDIBlock = result.risk_radar.some(r => {
    if ((r.category || '').includes('הלוואות קיימות')) return false;
    if (r.severity !== 'HIGH' && r.severity !== 'critical') return false;
    return BDI_NOGO_KEYWORDS.some(kw => (r.finding || '').toLowerCase().includes(kw.toLowerCase()));
  });
  if (hasBDIBlock) return true;
  const b = result.borrower_info || {};
  const isRefi = (result.detected_case_types || []).some(t => t.includes('מחזור') || t.includes('מיחזור'));
  const effectivePTI = isRefi ? (b.pti_consumer ?? b.pti_ratio ?? 0) : (b.pti_ratio ?? 0);
  return effectivePTI > 50;
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ num, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', paddingBottom: '10px', borderBottom: `1px solid ${D.border}` }}>
      <span style={{ fontSize: '10px', fontWeight: 900, color: D.gold, fontFamily: 'monospace', border: `1px solid ${D.gold}44`, borderRadius: '6px', padding: '2px 7px' }}>{num}</span>
      <span style={{ fontSize: '12px', fontWeight: 800, color: D.text, textTransform: 'uppercase', letterSpacing: '1.5px' }}>{label}</span>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: '130px', background: D.card, border: `1px solid ${D.border}`, borderTop: `3px solid ${color}`, borderRadius: '10px', padding: '14px 12px' }}>
      <div style={{ fontSize: '8px', color: D.muted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 900, fontFamily: 'monospace', color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Risk Row ──────────────────────────────────────────────────────────────────
function RiskRow({ risk, sev }) {
  const c = sev === 'HIGH' || sev === 'critical' ? D.red : sev === 'MEDIUM' ? D.yellow : D.green;
  const bg = sev === 'HIGH' || sev === 'critical' ? D.redBg : sev === 'MEDIUM' ? D.yellowBg : D.greenBg;
  return (
    <div style={{ background: bg, border: `1px solid ${c}44`, borderRight: `3px solid ${c}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: risk.recommendation ? '6px' : 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: D.text, lineHeight: 1.5, flex: 1 }}>{risk.finding}</div>
        {risk.category && <span style={{ fontSize: '9px', color: c, border: `1px solid ${c}44`, borderRadius: '10px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{risk.category}</span>}
      </div>
      {risk.recommendation && (
        <div style={{ fontSize: '10px', color: D.muted, background: D.card, borderRadius: '6px', padding: '6px 10px', lineHeight: 1.5 }}>{risk.recommendation}</div>
      )}
    </div>
  );
}

export default function QuickCheckReport({ result, reportType, onTransfer, onBuildFullPackage, preScanResult }) {
  const [buildingPackage, setBuildingPackage] = useState(false);
  if (!result) return null;

  // ── טיפול שגיאות מפורש: אם התקבל אובייקט שגיאה (status !== 200 / error בגוף) ──
  // הצג את סיבת ה-400 על המסך במקום לנסות לרנדר ולקרוס.
  if (result.error || result.status === 400) {
    return <ErrorMessage text={result.error || result.message} code={result.error_code} />;
  }

  // ── שומר הסף האמיתי: result קיים אך חסר נתוני ליבה (borrower_info) = תוצאה חלקית פגומה ──
  // זה היה החור: השרת החזיר אובייקט "כמעט ריק" שלא תפס את תנאי השגיאה למעלה,
  // והקוד המשיך לגשת ל-result.risk_radar / income_months → קריסת NULL בעומק.
  if (!result.borrower_info || typeof result.borrower_info !== 'object') {
    return <ErrorMessage
      text="הניתוח הסתיים אך לא הוחזרו נתוני לווה תקינים מהשרת. ייתכן שהמסמכים לא היו קריאים מספיק. נסה להעלות מחדש בקבצים באיכות גבוהה יותר."
      code="NO_BORROWER_DATA"
    />;
  }

  const bankerLetter = result.bankerLetter || null;

  const b = result.borrower_info || {};
  const isNoGoCase = isNoGo(result);
  const mortgage = result.existing_mortgage;
  const isRefinance = reportType === 'מחזור משכנתא' || reportType === 'מיחזור משכנתא ואיחוד חובות' || reportType === 'גיל הזהב' || (reportType === 'זיהוי אוטומטי' && result.detected_case_types?.some(t => t.includes('מחזור')));
  const opportunityHook = computeOpportunityHook(result);
  const today = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
  const refNum = 'MKD-' + Date.now().toString().slice(-6);
  const income = b.total_household_income || b.avg_income || 0;
  const pti = b.pti_ratio || 0;
  const available = b.available_for_mortgage || 0;

  // Filter radar
  const EMPLOYEE_NUMBER_PATTERN = /000\d{6}/;
  const filteredRadar = (result.risk_radar || []).filter(r => {
    const finding = r.finding || '';
    if ((r.category || '').includes('אי-התאמת ת.ז') || finding.includes('אי-התאמת ת.ז')) {
      if (EMPLOYEE_NUMBER_PATTERN.test(finding)) return false;
    }
    return true;
  });
  const criticalSet = new Set(filteredRadar.filter(r => r.severity === 'HIGH' || r.severity === 'critical').map(r => r.finding));

  // ── PDF export (dark HTML) — מלא: כל הסעיפים שעל המסך ──────────────────────
  const downloadPdf = () => {
    try {
      toast.loading('מכין דו"ח מלא...');

      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sectionTitle = (num, label) => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid ${D.border};"><span style="font-size:10px;font-weight:900;color:${D.gold};border:1px solid ${D.gold}44;border-radius:6px;padding:2px 7px;">${num}</span><span style="font-size:12px;font-weight:800;color:${D.text};text-transform:uppercase;letter-spacing:1.5px;">${esc(label)}</span></div>`;
      const card = (inner) => `<div style="background:${D.card};border:1px solid ${D.border};border-radius:14px;padding:20px 22px;margin-bottom:16px;">${inner}</div>`;

      // ── KPIs ──
      const kpisHtml = [
        { label: 'הכנסת משק בית', value: income > 0 ? `₪${income.toLocaleString()}` : '—', color: income > 15000 ? D.green : D.yellow },
        { label: 'PTI נוכחי', value: pti > 0 ? `${pti.toFixed(1)}%` : '—', color: ptiColor(pti) },
        { label: 'כושר החזר פנוי', value: available > 0 ? `₪${available.toLocaleString()}` : '—', color: available > 5000 ? D.green : available > 0 ? D.yellow : D.red },
        ...(mortgage?.remaining_balance > 0 ? [{ label: 'יתרת משכנתא', value: `₪${mortgage.remaining_balance.toLocaleString()}`, color: D.blue }] : []),
      ].map(k => `<div style="flex:1;min-width:130px;background:${D.card};border:1px solid ${D.border};border-top:3px solid ${k.color};border-radius:10px;padding:14px 12px;"><div style="font-size:8px;color:${D.muted};text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">${k.label}</div><div style="font-size:20px;font-weight:900;font-family:monospace;color:${k.color};line-height:1;">${k.value}</div></div>`).join('');

      // ── Borrowers header ──
      const borrowerCard = (label, name, idv, employer, empType, incomeV) => `<div style="flex:1;min-width:180px;background:${D.card};border:1px solid ${D.border};border-radius:10px;padding:14px 16px;"><div style="font-size:8px;color:${D.muted};text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">${esc(label)}</div><div style="font-size:16px;font-weight:900;color:white;margin-bottom:8px;">${esc(name || '—')}</div>${idv ? `<div style="font-size:10px;color:${D.muted};">ת.ז: <span style="font-family:monospace;color:${D.text};">${esc(idv)}</span></div>` : ''}${employer ? `<div style="font-size:10px;color:${D.muted};">מעסיק: <strong style="color:${D.text};">${esc(employer)}</strong></div>` : ''}${empType ? `<div style="font-size:10px;color:${D.muted};">סטטוס: <strong>${esc(empType)}</strong></div>` : ''}${incomeV > 0 ? `<div style="margin-top:8px;font-size:14px;font-weight:900;color:${D.green};">₪${incomeV.toLocaleString()} נטו/חודש</div>` : ''}</div>`;
      const borrowersHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;">${borrowerCard('לווה ראשי', b.name, b.id, b.employer, b.employment_type, b.avg_income)}${b.name_2 ? borrowerCard('לווה שני', b.name_2, b.id_2, b.employer_2, b.employment_type_2, b.avg_income_2) : ''}</div>`;

      // ── Risk radar ──
      const radarHtml = ['HIGH', 'MEDIUM', 'LOW'].map(sev => {
        const items = filteredRadar.filter(r => {
          if (r.severity !== sev && !(sev === 'HIGH' && r.severity === 'critical')) return false;
          if (sev === 'MEDIUM' && criticalSet.has(r.finding)) return false;
          return true;
        });
        if (!items.length) return '';
        const c = sev === 'HIGH' ? D.red : sev === 'MEDIUM' ? D.yellow : D.green;
        const bg = sev === 'HIGH' ? D.redBg : sev === 'MEDIUM' ? D.yellowBg : D.greenBg;
        const lbl = sev === 'HIGH' ? `ממצאים קריטיים (${items.length})` : sev === 'MEDIUM' ? `ממצאים לטיפול (${items.length})` : `חוזקות התיק (${items.length})`;
        return `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:800;color:${c};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid ${c}44;">${lbl}</div>${items.map(risk => `<div style="background:${bg};border:1px solid ${c}44;border-right:3px solid ${c};border-radius:8px;padding:10px 14px;margin-bottom:6px;"><div style="font-size:11px;font-weight:700;color:${D.text};line-height:1.5;">${esc(risk.finding)}</div>${risk.recommendation ? `<div style="font-size:10px;color:${D.muted};background:${D.card};border-radius:6px;padding:6px 10px;margin-top:6px;">${esc(risk.recommendation)}</div>` : ''}</div>`).join('')}</div>`;
      }).join('');

      // ── Banker letter ──
      const bankerHtml = bankerLetter
        ? `<div style="background:${D.bg};border:1px solid ${D.border};border-right:4px solid ${D.gold};border-radius:10px;padding:20px 22px;line-height:1.9;font-size:12px;color:${D.text};white-space:pre-wrap;">${esc(bankerLetter)}</div>`
        : '';

      // ── Income months ──
      const incomeMonthsHtml = (result.income_months?.length > 0)
        ? `<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#0a1f16;">${['חודש', 'ברוטו', 'נטו', 'הערה'].map(h => `<th style="padding:7px 10px;text-align:right;font-weight:700;color:#fff;border-bottom:1px solid ${D.greenBorder};">${h}</th>`).join('')}</tr></thead><tbody>${result.income_months.map((m, i) => `<tr style="background:${i % 2 === 0 ? D.card : D.bg};border-bottom:1px solid ${D.border};"><td style="padding:7px 10px;font-weight:700;color:${D.text};">${esc(m.month)}</td><td style="padding:7px 10px;color:${D.text};font-family:monospace;">${m.gross ? `₪${m.gross.toLocaleString()}` : '—'}</td><td style="padding:7px 10px;font-weight:700;color:${D.green};font-family:monospace;">${m.net ? `₪${m.net.toLocaleString()}` : '—'}</td><td style="padding:7px 10px;color:${D.muted};font-size:10px;">${esc(m.note || '')}</td></tr>`).join('')}</tbody></table>${result.yearly_summary ? `<div style="margin-top:8px;padding:8px 12px;background:${D.greenBg};border:1px solid ${D.greenBorder};border-radius:6px;font-size:10px;color:${D.green};">${esc(result.yearly_summary)}</div>` : ''}`
        : '';

      // ── Strengths ──
      const strengthsHtml = (result.strengths?.length > 0)
        ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${result.strengths.map(s => `<div style="background:${D.greenBg};border:1px solid ${D.greenBorder};border-right:3px solid ${D.green};border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:${D.text};"><span style="color:${D.green};">✓</span> ${esc(s)}</div>`).join('')}</div>`
        : '';

      // ── Recommendations ──
      const recsHtml = (result.actionable_recommendations?.length > 0)
        ? ['חובה_לפני_הגשה', 'מומלץ', 'לבדיקה'].map(pri => {
            const items = result.actionable_recommendations.filter(r => r.priority === pri);
            if (!items.length) return '';
            const c = pri === 'חובה_לפני_הגשה' ? D.red : pri === 'מומלץ' ? D.yellow : D.muted;
            const bg = pri === 'חובה_לפני_הגשה' ? D.redBg : pri === 'מומלץ' ? D.yellowBg : D.bg;
            const lbl = pri === 'חובה_לפני_הגשה' ? 'חובה לפני הגשה לבנק' : pri === 'מומלץ' ? 'מומלץ להוסיף' : 'לבדיקה נוספת';
            return `<div style="margin-bottom:12px;"><div style="font-size:10px;font-weight:800;color:${c};text-transform:uppercase;margin-bottom:6px;">${lbl}</div>${items.map(r => `<div style="background:${bg};border:1px solid ${c}44;border-right:3px solid ${c};border-radius:8px;padding:8px 12px;margin-bottom:5px;font-size:11px;font-weight:700;color:${D.text};line-height:1.5;">${esc(r.text)}${r.for_whom ? ` <span style="font-size:9px;color:${D.muted};">(${esc(r.for_whom)})</span>` : ''}</div>`).join('')}</div>`;
          }).join('')
        : '';

      // ── Missing docs ──
      const missingHtml = (result.missing_docs?.length > 0)
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${result.missing_docs.map(d => `<span style="background:${D.card};border:1px solid ${D.red}44;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;color:${D.red};">✗ ${esc(d)}</span>`).join('')}</div>`
        : '';

      let sectionNum = 0;
      const nextNum = () => String(++sectionNum).padStart(2, '0');

      const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/><title>דו"ח חיתום מלא</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet"/><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Heebo',Arial,sans-serif;font-size:12px;color:${D.text};direction:rtl;background:${D.bg};line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page{max-width:820px;margin:0 auto;padding:36px 40px;}@page{size:A4;margin:14mm 12mm;}@media print{body{background:${D.bg}!important;}}</style></head><body><div class="page">
<div style="background:linear-gradient(135deg,${D.card},#111827);border:1px solid ${D.gold}33;border-radius:16px;padding:28px 32px;margin-bottom:24px;">
  <div style="font-size:15px;font-weight:900;color:white;">מיקוד משכנתאות</div>
  <div style="font-size:8px;color:${D.gold};letter-spacing:3px;margin-bottom:12px;">MIKUD MORTGAGES · QUICK CHECK REPORT</div>
  <div style="font-size:20px;font-weight:900;color:white;">דו"ח חיתום מקצועי מלא</div>
  <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
    <span style="font-size:9px;color:${D.muted};background:${D.card};border:1px solid ${D.border};border-radius:20px;padding:3px 10px;">${today}</span>
    <span style="font-size:9px;color:${D.gold};background:${D.gold}11;border:1px solid ${D.gold}44;border-radius:20px;padding:3px 10px;font-family:monospace;">${refNum}</span>
  </div>
</div>
${card(sectionTitle(nextNum(), 'פרטי הלווים') + borrowersHtml)}
${card(sectionTitle(nextNum(), 'מדדים פיננסיים מרכזיים') + `<div style="display:flex;gap:10px;flex-wrap:wrap;">${kpisHtml}</div>`)}
${bankerHtml ? card(sectionTitle(nextNum(), 'מכתב חיתום — לבנק') + bankerHtml) : ''}
${incomeMonthsHtml ? card(sectionTitle(nextNum(), 'ניתוח הכנסות חודשי') + incomeMonthsHtml) : ''}
${strengthsHtml ? card(sectionTitle(nextNum(), 'חוזקות התיק') + strengthsHtml) : ''}
${radarHtml ? card(sectionTitle(nextNum(), 'מטריצת סיכונים') + radarHtml) : ''}
${recsHtml ? card(sectionTitle(nextNum(), 'פעולות נדרשות') + recsHtml) : ''}
${missingHtml ? card(sectionTitle(nextNum(), 'מסמכים חסרים') + missingHtml) : ''}
<div style="margin-top:28px;padding-top:16px;border-top:1px solid ${D.border};display:flex;justify-content:space-between;"><div style="font-size:8px;color:${D.dim};">מיקוד משכנתאות · office@mikud4me.co.il · *2324</div><div style="font-size:8px;color:${D.dim};font-family:monospace;">${refNum} · ${today}</div></div>
</div></body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) win.onload = () => setTimeout(() => win.print(), 500);
      toast.dismiss();
      toast.success('הדוח המלא נפתח — הדפס או שמור כ-PDF');
    } catch (e) {
      toast.dismiss();
      toast.error('שגיאה ביצירת הדוח');
    }
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', sans-serif", background: D.bg, minHeight: '100%', padding: '0 0 40px 0' }}>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <button onClick={downloadPdf} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: `linear-gradient(135deg,${D.gold},#8B6E32)`, color: '#0A0F1A', fontWeight: 800, fontSize: '13px', padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
          <Download style={{ width: '16px', height: '16px' }} />
          הורד דו"ח PDF
        </button>
        {onBuildFullPackage && (
          <button
            onClick={async () => { setBuildingPackage(true); try { await onBuildFullPackage(); } finally { setBuildingPackage(false); } }}
            disabled={buildingPackage}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#1e3a5f', color: 'white', fontWeight: 800, fontSize: '13px', padding: '10px 20px', borderRadius: '10px', border: `1px solid ${D.gold}66`, cursor: buildingPackage ? 'wait' : 'pointer', opacity: buildingPackage ? 0.6 : 1 }}
          >
            {buildingPackage ? <Loader2 style={{ width: '16px', height: '16px' }} className="animate-spin" /> : <FolderArchive style={{ width: '16px', height: '16px' }} />}
            תיק הגשה מלא
          </button>
        )}
        {onTransfer && (
          <button onClick={onTransfer} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#166534', color: 'white', fontWeight: 800, fontSize: '13px', padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <ArrowLeft style={{ width: '16px', height: '16px' }} />
            העבר לתהליך מלא
          </button>
        )}
      </div>

      {/* Validation Warnings */}
      {result.validation_warnings?.length > 0 && (
        <div style={{ background: D.redBg, border: `2px solid ${D.red}`, borderRadius: '12px', padding: '14px 20px', marginBottom: '16px' }}>
          <div style={{ color: D.red, fontWeight: 800, fontSize: '13px', marginBottom: '8px' }}>נתונים קריטיים חסרים — נדרש אימות ידני לפני שליחה לבנק</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.validation_warnings.map((w, i) => (
              <div key={i} style={{ background: D.card, border: `1px solid ${w.severity === 'HIGH' ? D.redBorder : D.yellowBorder}`, borderRight: `4px solid ${w.severity === 'HIGH' ? D.red : D.yellow}`, borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: D.text, fontWeight: 600 }}>
                {w.severity === 'HIGH' ? '🔴' : '🟡'} <strong>{w.field}:</strong> {w.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opportunity Hook, Gap Analysis, Anomaly Shield */}
      <OpportunityHook opportunityData={opportunityHook} />
      <DynamicGapAnalysis result={result} preScanResult={preScanResult} reportType={reportType} />
      <AnomalyShield result={result} />

      {/* Normalization Banner */}
      {result.income_normalized && (
        <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)', border: `2px solid ${D.gold}`, borderRadius: '12px', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Zap style={{ width: '20px', height: '20px', color: D.yellow, flexShrink: 0 }} />
          <div>
            <div style={{ color: D.gold, fontWeight: 800, fontSize: '13px' }}>זיהוי כירורגי: נרמול הכנסה בוצע</div>
            <div style={{ color: D.muted, fontSize: '11px', marginTop: '2px' }}>המערכת זיהתה חופשת לידה / שבתון וביצעה נרמול הכנסה על בסיס נתוני עבר.</div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          COVER HEADER
      ══════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(135deg,#0d1524 0%,#111827 60%,#0a1420 100%)', border: `1px solid ${D.gold}33`, borderRadius: '16px', padding: '28px 32px', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
        {/* Grid texture */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.025, backgroundImage: `linear-gradient(${D.gold} 1px,transparent 1px),linear-gradient(90deg,${D.gold} 1px,transparent 1px)`, backgroundSize: '40px 40px', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          {/* Brand + title */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', background: `linear-gradient(135deg,${D.gold},#8B6E32)`, borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><polygon points="11,2 20,19 2,19" stroke="white" strokeWidth="1.5" fill="none" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 900, color: 'white' }}>מיקוד משכנתאות</div>
                <div style={{ fontSize: '8px', color: D.gold, letterSpacing: '3px' }}>MIKUD MORTGAGES · QUICK CHECK</div>
              </div>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 900, color: 'white', lineHeight: 1.2 }}>דו"ח חיתום מקצועי<br/>ניתוח תיק לקוח</div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '9px', color: D.muted, background: D.card, border: `1px solid ${D.border}`, borderRadius: '20px', padding: '3px 10px' }}>{today}</span>
              <span style={{ fontSize: '9px', color: D.gold, background: `${D.gold}11`, border: `1px solid ${D.gold}44`, borderRadius: '20px', padding: '3px 10px', fontFamily: 'monospace' }}>{refNum}</span>
              {result.detected_case_types?.length
                ? result.detected_case_types.map((t, i) => <span key={i} style={{ fontSize: '9px', color: D.yellow, background: D.yellowBg, border: `1px solid ${D.yellowBorder}`, borderRadius: '20px', padding: '3px 10px' }}>{t}</span>)
                : <span style={{ fontSize: '9px', color: D.muted, background: D.card, border: `1px solid ${D.border}`, borderRadius: '20px', padding: '3px 10px' }}>{reportType || 'ניתוח כללי'}</span>
              }
            </div>
          </div>
          {/* PTI Circle */}
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: D.card, border: `3px solid ${ptiColor(pti)}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 30px ${ptiColor(pti)}44` }}>
              <div style={{ fontSize: '10px', color: D.muted }}>PTI</div>
              <div style={{ fontSize: '26px', fontWeight: 900, fontFamily: 'monospace', color: ptiColor(pti), lineHeight: 1 }}>{pti > 0 ? `${pti.toFixed(0)}%` : '—'}</div>
            </div>
            <div style={{ marginTop: '6px', fontSize: '9px', color: D.muted }}>יחס החזר</div>
          </div>
        </div>

        {/* Borrower cards */}
        <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: `1px solid ${D.border}`, display: 'flex', gap: '10px', flexWrap: 'wrap', position: 'relative' }}>
          {/* Borrower 1 */}
          <div style={{ flex: 1, minWidth: '180px', background: D.card, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '8px', color: D.muted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '6px' }}>לווה ראשי</div>
            <div style={{ fontSize: '16px', fontWeight: 900, color: 'white', marginBottom: '8px' }}>{b.name || '—'}</div>
            {b.id && <div style={{ fontSize: '10px', color: D.muted }}>ת.ז: <span style={{ fontFamily: 'monospace', color: D.text }}>{b.id}</span></div>}
            {b.employer && <div style={{ fontSize: '10px', color: D.muted }}>מעסיק: <strong style={{ color: D.text }}>{b.employer}</strong></div>}
            {b.employment_type && <div style={{ fontSize: '10px', color: b.employment_type.includes('שבתון') || b.employment_type.includes('חל"ת') ? D.red : D.muted }}>סטטוס: <strong>{b.employment_type}</strong></div>}
            {b.seniority_years && <div style={{ fontSize: '10px', color: D.muted }}>ותק: {b.seniority_years} שנים</div>}
            {b.special_status && b.special_status !== 'N/A' && b.special_status.trim() && <div style={{ marginTop: '6px', background: D.yellowBg, border: `1px solid ${D.yellowBorder}`, borderRadius: '6px', padding: '4px 8px', fontSize: '10px', color: D.yellow, fontWeight: 700 }}>{b.special_status}</div>}
            {b.avg_income > 0 && <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 900, color: D.green }}>₪{b.avg_income.toLocaleString()} נטו/חודש</div>}
          </div>
          {/* Borrower 2 */}
          {b.name_2 && (
            <div style={{ flex: 1, minWidth: '180px', background: D.card, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '8px', color: D.muted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '6px' }}>לווה שני</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: 'white', marginBottom: '8px' }}>{b.name_2}</div>
              {b.id_2 && <div style={{ fontSize: '10px', color: D.muted }}>ת.ז: <span style={{ fontFamily: 'monospace', color: D.text }}>{b.id_2}</span></div>}
              {b.employer_2 && <div style={{ fontSize: '10px', color: D.muted }}>מעסיק: <strong style={{ color: D.text }}>{b.employer_2}</strong></div>}
              {b.employment_type_2 && <div style={{ fontSize: '10px', color: b.employment_type_2.includes('שבתון') || b.employment_type_2.includes('חל"ת') ? D.red : D.muted }}>סטטוס: <strong>{b.employment_type_2}</strong></div>}
              {b.special_status_2 && b.special_status_2 !== 'N/A' && b.special_status_2.trim() && <div style={{ marginTop: '6px', background: D.yellowBg, border: `1px solid ${D.yellowBorder}`, borderRadius: '6px', padding: '4px 8px', fontSize: '10px', color: D.yellow, fontWeight: 700 }}>{b.special_status_2}</div>}
              {b.avg_income_2 > 0 && <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 900, color: D.green }}>₪{b.avg_income_2.toLocaleString()} נטו/חודש</div>}
            </div>
          )}
          {/* Financials */}
          <div style={{ flex: 1, minWidth: '180px', background: D.card, border: `2px solid ${D.gold}44`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '8px', color: D.muted, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '8px' }}>נתונים פיננסיים</div>
            {income > 0 && <div style={{ marginBottom: '8px' }}><div style={{ fontSize: '9px', color: D.dim }}>הכנסת משק בית נטו</div><div style={{ fontSize: '20px', fontWeight: 900, color: D.gold, fontFamily: 'monospace' }}>₪{income.toLocaleString()}</div></div>}
            {pti > 0 && <div style={{ marginBottom: '6px' }}><div style={{ fontSize: '9px', color: D.dim }}>PTI נוכחי</div><div style={{ fontSize: '16px', fontWeight: 800, color: ptiColor(pti), fontFamily: 'monospace' }}>{pti.toFixed(1)}%</div></div>}
            {b.max_allowed_mortgage_payment > 0 && <div style={{ marginBottom: '6px' }}><div style={{ fontSize: '9px', color: D.dim }}>תשלום מקסימלי (40%)</div><div style={{ fontSize: '13px', fontWeight: 800, color: D.blue, fontFamily: 'monospace' }}>₪{b.max_allowed_mortgage_payment.toLocaleString()}</div></div>}
            {available > 0 && <div style={{ marginBottom: '6px' }}><div style={{ fontSize: '9px', color: D.dim }}>כושר החזר פנוי</div><div style={{ fontSize: '13px', fontWeight: 800, color: available < 2000 ? D.red : D.green, fontFamily: 'monospace' }}>₪{available.toLocaleString()}</div></div>}
            {b.alimony_monthly > 0 && <div><div style={{ fontSize: '9px', color: D.dim }}>מזונות חודשיים</div><div style={{ fontSize: '13px', fontWeight: 800, color: D.red, fontFamily: 'monospace' }}>₪{b.alimony_monthly.toLocaleString()}</div></div>}
          </div>
        </div>
      </div>

      {/* ══ 01. KPI Cards ══ */}
      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
        <SectionTitle num="01" label="מדדים פיננסיים מרכזיים" />
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <KPICard label="הכנסת משק בית" value={income > 0 ? `₪${income.toLocaleString()}` : '—'} color={income > 15000 ? D.green : D.yellow} />
          <KPICard label="PTI נוכחי" value={pti > 0 ? `${pti.toFixed(1)}%` : '—'} color={ptiColor(pti)} />
          <KPICard label="כושר החזר פנוי" value={available > 0 ? `₪${available.toLocaleString()}` : '—'} color={available > 5000 ? D.green : available > 0 ? D.yellow : D.red} />
          {mortgage?.remaining_balance > 0 && <KPICard label="יתרת משכנתא" value={`₪${mortgage.remaining_balance.toLocaleString()}`} color={D.blue} />}
        </div>
      </div>

      {/* ══ 02. Existing Mortgage (Refinance) ══ */}
      {isRefinance && mortgage?.remaining_balance > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
          <SectionTitle num="02" label={`משכנתא קיימת — ${mortgage.bank_name || 'בנק מלווה'}`} />
          <div style={{ background: D.blueBg, border: `1px solid ${D.blueBorder}`, borderRadius: '12px', padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '12px' }}>
              {[
                { l: 'יתרה לסילוק', v: `₪${mortgage.remaining_balance.toLocaleString()}`, c: D.blue },
                { l: 'ריבית ממוצעת', v: `${mortgage.average_interest_rate?.toFixed(2) || '?'}%`, c: D.red },
                { l: 'החזר חודשי', v: `₪${mortgage.monthly_payment?.toLocaleString() || '?'}`, c: D.text },
                { l: 'חודשים שנותרו', v: `${mortgage.remaining_months || '?'}`, c: D.muted },
              ].map((x, i) => (
                <div key={i} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '8px', color: D.muted, marginBottom: '4px' }}>{x.l}</div>
                  <div style={{ fontSize: '16px', fontWeight: 900, fontFamily: 'monospace', color: x.c }}>{x.v}</div>
                </div>
              ))}
            </div>
            {mortgage.early_repayment_fee > 0 && (
              <div style={{ background: D.yellowBg, border: `1px solid ${D.yellowBorder}`, borderRadius: '6px', padding: '7px 12px', fontSize: '10px', color: D.yellow, marginBottom: '12px' }}>
                עמלת פירעון מוקדם: <strong>₪{mortgage.early_repayment_fee.toLocaleString()}</strong>
              </div>
            )}
            {mortgage.tracks?.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                <thead>
                  <tr style={{ background: D.bg }}>
                    {['מסלול', 'יתרה', 'ריבית', 'חודשים', 'הצמדה'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: D.blue, borderBottom: `1px solid ${D.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mortgage.tracks.map((t, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? D.card : D.bg, borderBottom: `1px solid ${D.border}` }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: D.text }}>{t.track_type}</td>
                      <td style={{ padding: '7px 10px', color: D.text, fontFamily: 'monospace' }}>₪{t.remaining_balance?.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: D.red, fontWeight: 700 }}>{t.interest_rate?.toFixed(2)}%</td>
                      <td style={{ padding: '7px 10px', color: D.muted }}>{t.remaining_months}</td>
                      <td style={{ padding: '7px 10px', color: t.is_index_linked ? D.yellow : D.dim }}>{t.is_index_linked ? '✓ צמוד' : 'לא צמוד'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ 03. Income Months ══ */}
      {result.income_months?.length > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
          <SectionTitle num="03" label="ניתוח הכנסות חודשי" />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: '#0a1f16' }}>
                {['חודש', 'ברוטו', 'נטו', 'הערה'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#ffffff', borderBottom: `1px solid ${D.greenBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.income_months.map((m, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? D.card : D.bg, borderBottom: `1px solid ${D.border}` }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: D.text }}>{m.month}</td>
                  <td style={{ padding: '7px 10px', color: D.text, fontFamily: 'monospace' }}>{m.gross ? `₪${m.gross.toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: D.green, fontFamily: 'monospace' }}>{m.net ? `₪${m.net.toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '7px 10px', color: D.muted, fontSize: '10px' }}>{m.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.yearly_summary && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: D.greenBg, border: `1px solid ${D.greenBorder}`, borderRadius: '6px', fontSize: '10px', color: D.green }}>
              {result.yearly_summary}
            </div>
          )}
        </div>
      )}

      {/* ══ 04. Banker Letter ══ */}
      <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
        <SectionTitle num="04" label="מכתב חיתום — לבנק" />
        {isNoGoCase && (
          <div style={{ background: D.redBg, border: `2px solid ${D.red}`, borderRadius: '10px', padding: '14px 18px', marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: D.red, fontWeight: 900, fontSize: '12px', marginBottom: '4px' }}>תיק זה אינו כשיר להגשה לבנק במצבו הנוכחי</div>
              <div style={{ color: D.muted, fontSize: '10px', lineHeight: 1.6 }}>זוהו חוסמים קריטיים (BDI / עיקול / PTI חריג) המחייבים טיפול מיידי לפני כל פנייה לבנק.</div>
            </div>
          </div>
        )}
        <div style={{ background: D.bg, border: `1px solid ${isNoGoCase ? D.red + '44' : D.border}`, borderRight: `4px solid ${D.gold}`, borderRadius: '10px', padding: '20px 22px', lineHeight: 1.9, fontSize: '12px', color: D.text, whiteSpace: 'pre-wrap', opacity: isNoGoCase ? 0.7 : 1 }}>
          {bankerLetter || <span style={{ color: D.dim }}>לחץ על "ייצר מכתב מלא לבנק" כדי לקבל את המכתב המקצועי</span>}
        </div>
      </div>

      {/* ══ 05. Strengths ══ */}
      {result.strengths?.length > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
          <SectionTitle num="05" label={`חוזקות התיק — ${result.strengths.length} נקודות חוזק`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px' }}>
            {result.strengths.map((s, i) => (
              <div key={i} style={{ background: D.greenBg, border: `1px solid ${D.greenBorder}`, borderRight: `3px solid ${D.green}`, borderRadius: '8px', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: D.text, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <span style={{ color: D.green, flexShrink: 0 }}>✓</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ 06. Risk Radar ══ */}
      {filteredRadar.length > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
          <SectionTitle num="06" label="מטריצת סיכונים — Risk Radar" />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {[
              { label: `${filteredRadar.filter(r => r.severity === 'HIGH' || r.severity === 'critical').length} ממצאים קריטיים`, color: D.red, bg: D.redBg },
              { label: `${filteredRadar.filter(r => r.severity === 'MEDIUM').length} בינוניים`, color: D.yellow, bg: D.yellowBg },
              { label: `${filteredRadar.filter(r => r.severity === 'LOW').length} חוזקות`, color: D.green, bg: D.greenBg },
            ].map((badge, i) => (
              <span key={i} style={{ fontSize: '10px', fontWeight: 700, color: badge.color, background: badge.bg, border: `1px solid ${badge.color}44`, borderRadius: '20px', padding: '3px 12px' }}>{badge.label}</span>
            ))}
          </div>
          {['HIGH', 'MEDIUM', 'LOW'].map(sev => {
            const items = filteredRadar.filter(r => {
              if (r.severity !== sev && !(sev === 'HIGH' && r.severity === 'critical')) return false;
              if (sev === 'MEDIUM' && criticalSet.has(r.finding)) return false;
              return true;
            });
            if (!items.length) return null;
            const c = sev === 'HIGH' ? D.red : sev === 'MEDIUM' ? D.yellow : D.green;
            const lbl = sev === 'HIGH' ? 'ממצאים קריטיים' : sev === 'MEDIUM' ? 'ממצאים לטיפול' : 'חוזקות התיק';
            return (
              <div key={sev} style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: c, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', paddingBottom: '4px', borderBottom: `1px solid ${c}44` }}>
                  {lbl} ({items.length})
                </div>
                {items.map((risk, i) => <RiskRow key={i} risk={risk} sev={sev} />)}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ 07. Equity Evidence ══ */}
      {result.total_equity_evidence > 0 && (
        <div style={{ background: D.greenBg, border: `2px solid ${D.greenBorder}`, borderRadius: '12px', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: D.green, marginBottom: '6px' }}>הון עצמי מוכח בעו"ש</div>
          <div style={{ fontSize: '20px', fontWeight: 900, color: D.green, fontFamily: 'monospace', marginBottom: '8px' }}>₪{result.total_equity_evidence.toLocaleString()}</div>
          {result.equity_events?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {result.equity_events.map((e, i) => (
                <span key={i} style={{ background: D.card, border: `1px solid ${D.greenBorder}`, borderRadius: '20px', padding: '3px 10px', fontSize: '10px', color: D.green, fontWeight: 600 }}>
                  {e.date} · {e.description} · ₪{(e.amount || 0).toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ 08. Actionable Recommendations ══ */}
      {result.actionable_recommendations?.length > 0 && (
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: '14px', padding: '20px 22px', marginBottom: '16px' }}>
          <SectionTitle num="08" label="פעולות נדרשות" />
          {['חובה_לפני_הגשה', 'מומלץ', 'לבדיקה'].map(pri => {
            const items = result.actionable_recommendations.filter(r => r.priority === pri);
            if (!items.length) return null;
            const c = pri === 'חובה_לפני_הגשה' ? D.red : pri === 'מומלץ' ? D.yellow : D.muted;
            const bg = pri === 'חובה_לפני_הגשה' ? D.redBg : pri === 'מומלץ' ? D.yellowBg : D.bg;
            const lbl = pri === 'חובה_לפני_הגשה' ? 'חובה לפני הגשה לבנק' : pri === 'מומלץ' ? 'מומלץ להוסיף' : 'לבדיקה נוספת';
            return (
              <div key={pri} style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: c, textTransform: 'uppercase', marginBottom: '6px' }}>{lbl}</div>
                {items.map((r, i) => (
                  <div key={i} style={{ background: bg, border: `1px solid ${c}44`, borderRight: `3px solid ${c}`, borderRadius: '8px', padding: '8px 12px', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: D.text, flex: 1, lineHeight: 1.5 }}>{r.text}</div>
                    {r.for_whom && <span style={{ fontSize: '9px', color: D.muted, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.for_whom}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ 09. Missing Docs ══ */}
      {result.missing_docs?.length > 0 && (
        <div style={{ background: D.redBg, border: `1.5px solid ${D.red}44`, borderRadius: '12px', padding: '14px 18px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: D.red, marginBottom: '8px' }}>מסמכים חסרים להשלמת התיק</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {result.missing_docs.map((d, i) => (
              <span key={i} style={{ background: D.card, border: `1px solid ${D.red}44`, borderRadius: '20px', padding: '4px 12px', fontSize: '11px', fontWeight: 600, color: D.red }}>✗ {d}</span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '9px', color: D.dim }}>מיקוד משכנתאות · office@mikud4me.co.il · *2324<br/>מסמך זה הופק על ידי מערכת ניתוח AI מקצועית ומוגש כשירות ייעוץ בלבד.</div>
        <div style={{ fontSize: '9px', color: D.dim, fontFamily: 'monospace' }}>{refNum} · {today}</div>
      </div>

    </div>
  );
}