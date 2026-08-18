import React, { useRef, useState } from 'react';
import { X, Printer, FileText, CheckCircle, AlertTriangle } from 'lucide-react';

const fmt = (n) => n ? `₪${Math.round(n).toLocaleString('he-IL')}` : '—';
const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';

export default function PrintableSubmissionPackage({ scoreObject, caseData, onClose }) {
  const printRef = useRef(null);

  const handlePrint = () => setTimeout(() => window.print(), 500);

  const kpi = scoreObject?.kpi || {};
  const borrowers = scoreObject?.borrowers || {};
  const b1 = borrowers.borrower1 || {};
  const b2 = borrowers.borrower2;
  // scoreObject.documents = verification cards (no file_url). Use caseData.documents (DB records) for appendix.
  const docs = scoreObject?.documents || [];
  const identity = scoreObject?.identityVerification || {};
  const checklist = scoreObject?.checklist || [];
  const riskAnalysis = scoreObject?.riskAnalysis || {};
  const executiveSummary = scoreObject?.executive_summary || '';
  const caseNumber = caseData?.case_number || 'N/A';
  const today = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });

  // Group verification-card docs by type (for tables, no file_url needed)
  const payslipDocs = docs.filter(d => d.document_type === 'salary_slip');
  const bankDocs = docs.filter(d => d.document_type === 'bank_statement');
  const idDocs = docs.filter(d => d.document_type === 'id_card');

  // Appendix: pull actual uploaded files from caseData (DB Document entities)
  // Each record has: document_type, file_url, month_year, extracted_data, borrower_id
  const resolveUrl = (d) => {
    if (!d) return null;
    if (typeof d === 'string' && d.startsWith('http')) return d;
    return d?.file_url || d?.url || d?.file || d?.signed_url || (d?.original_file?.url) || null;
  };

  // Source 1: DB Document entities (passed as caseData.documents from Dashboard)
  const entityDocs = (caseData?.documents || []).filter(d => typeof d === 'object' && resolveUrl(d));

  // Source 2: fallback — URL strings stored directly on MortgageCase (caseData.source_files / attachments)
  const fallbackUrls = [
    ...(Array.isArray(caseData?.source_files) ? caseData.source_files : []),
    ...(Array.isArray(caseData?.attachments) ? caseData.attachments : []),
    ...(Array.isArray(caseData?.documents) ? caseData.documents.filter(d => typeof d === 'string') : []),
  ].filter(u => typeof u === 'string' && u.startsWith('http'));

  const fallbackDocs = fallbackUrls.map((url, i) => ({
    id: `fallback-${i}`,
    file_url: url,
    document_type: url.toLowerCase().includes('id') ? 'id_card' : 'other',
    month_year: null,
    extracted_data: {}
  }));

  console.log('[PrintableSubmissionPackage] caseData keys:', caseData ? Object.keys(caseData) : 'null');
  console.log('[PrintableSubmissionPackage] entityDocs:', entityDocs.length, entityDocs.map(d => ({ type: d.document_type, url: resolveUrl(d)?.substring(0, 80) })));
  console.log('[PrintableSubmissionPackage] fallbackDocs:', fallbackDocs.length);

  const rawFileDocs = entityDocs.length > 0 ? entityDocs : fallbackDocs;

  const TYPE_ORDER = ['id_card', 'salary_slip', 'bank_statement'];
  const sortedFileDocs = [...rawFileDocs].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.document_type);
    const bi = TYPE_ORDER.indexOf(b.document_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const appendixDocs = sortedFileDocs;

  const DOC_TYPE_LABEL = {
    id_card: 'תעודת זהות',
    salary_slip: 'תלוש שכר',
    bank_statement: 'דף עו"ש',
    tax_assessment: 'שומת מס',
    cpa_letter: 'מכתב רואה חשבון',
    employment_letter: 'מכתב העסקה',
    mortgage_statement: 'הצהרת משכנתא',
    other: 'מסמך',
  };

  const isPdf = (url) => url && (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf'));

  const getRatingColor = (rating) => {
    if (!rating) return '#374151';
    const r = rating.toUpperCase();
    if (r.startsWith('A')) return '#166534';
    if (r.startsWith('B')) return '#1e3a5f';
    if (r.startsWith('C')) return '#7c2d12';
    return '#374151';
  };

  return (
    <>
      {/* Print-specific global styles */}
      <style>{`
        @media print {
          .no-print, [class*="no-print"] { display: none !important; }
          body, html { background: white !important; overflow: visible !important; height: auto !important; }
          .fixed { position: static !important; overflow: visible !important; }
          #printable-package {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          @page { margin: 15mm 12mm; size: A4; }
          .page-break { page-break-before: always; }
        }
      `}</style>

      {/* Modal Overlay — scrollable dark preview */}
      <div className="fixed inset-0 z-[9999] bg-gray-900/90 overflow-y-auto py-12 px-4 no-print">
        {/* Toolbar */}
        <div className="sticky top-0 z-[10000] flex items-center justify-center gap-3 no-print bg-gray-900/95 backdrop-blur-sm border-b border-gray-700 px-6 py-3 -mx-4 -mt-12 mb-8">
          <span className="text-sm font-semibold text-gray-200">תיק הגשה מוסדי — {caseNumber}</span>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-white text-gray-900 text-sm px-4 py-1.5 rounded-lg hover:bg-gray-100 transition-colors font-semibold"
          >
            <Printer className="w-4 h-4" />
            הדפס / PDF
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
            סגור
          </button>
        </div>

        {/* The printable document */}
        <div
          id="printable-package"
          ref={printRef}
          className="bg-white w-full max-w-[210mm] mx-auto shadow-2xl rounded-xl p-12 overflow-visible"
          dir="rtl"
          style={{ fontFamily: "'Heebo', 'Arial', sans-serif", color: '#111827' }}
        >

          {/* ═══════════════════════════════════════════════════
              דף 1: שער + תקציר מנהלים + KPI
          ═══════════════════════════════════════════════════ */}
          <div className="px-12 pt-10 pb-8">

            {/* Header / Cover */}
            <div className="flex items-start justify-between border-b-2 border-gray-900 pb-6 mb-6">
              <div>
                <div className="text-xs font-bold tracking-widest text-gray-500 uppercase mb-1">מיקוד משכנתאות</div>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">
                  תיק הגשה מוסדי
                </h1>
                <p className="text-sm text-gray-500 mt-1">חוות דעת חיתום לוועדת אשראי</p>
              </div>
              <div className="text-left text-sm text-gray-600 space-y-0.5">
                <div><span className="font-semibold">מספר תיק:</span> {caseNumber}</div>
                <div><span className="font-semibold">תאריך:</span> {today}</div>
                <div><span className="font-semibold">לווה ראשי:</span> {b1.name || '—'}</div>
                {b2?.name && <div><span className="font-semibold">לווה שני:</span> {b2.name}</div>}
              </div>
            </div>

            {/* Rating Banner */}
            {kpi.rating && (
              <div
                className="rounded-lg px-6 py-4 mb-6 flex items-center justify-between"
                style={{ backgroundColor: getRatingColor(kpi.rating), color: 'white' }}
              >
                <div>
                  <div className="text-xs font-semibold tracking-widest uppercase opacity-80">דירוג חיתומי</div>
                  <div className="text-3xl font-black mt-0.5">{kpi.rating}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs opacity-80">ציון סיכון</div>
                  <div className="text-4xl font-black">{kpi.risk_score || '—'}</div>
                  <div className="text-xs opacity-70">מתוך 100</div>
                </div>
                <div className="text-right space-y-1 text-sm">
                  <div><span className="opacity-80">PTI:</span> <strong>{fmtPct(kpi.pti_unified)}</strong></div>
                  <div><span className="opacity-80">LTV:</span> <strong>{fmtPct(kpi.ltv)}</strong></div>
                  <div><span className="opacity-80">הכנסה מאומתת:</span> <strong>{fmt(kpi.verified_income)}</strong></div>
                </div>
              </div>
            )}

            {/* KPI Grid */}
            <table className="w-full border-collapse text-sm mb-6">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-2 pr-0 font-semibold text-gray-700">מדד</th>
                  <th className="text-center py-2 font-semibold text-gray-700">ערך</th>
                  <th className="text-right py-2 font-semibold text-gray-700">מדד</th>
                  <th className="text-center py-2 font-semibold text-gray-700">ערך</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-0 text-gray-600">הכנסה חודשית נטו</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmt(kpi.verified_income)}</td>
                  <td className="py-2 text-gray-600">שווי נכס</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmt(kpi.property_value)}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-0 text-gray-600">סך התחייבויות חודשי</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmt(kpi.total_liabilities)}</td>
                  <td className="py-2 text-gray-600">יחס PTI</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmtPct(kpi.pti_unified)}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-0 text-gray-600">כושר החזר פנוי (40%)</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmt(kpi.available_for_mortgage)}</td>
                  <td className="py-2 text-gray-600">יחס LTV</td>
                  <td className="py-2 text-center font-mono font-semibold">{fmtPct(kpi.ltv)}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-0 text-gray-600">רמת ביטחון AI</td>
                  <td className="py-2 text-center font-mono font-semibold">{kpi.confidence_level ? `${kpi.confidence_level}%` : '—'}</td>
                  <td className="py-2 text-gray-600">גורמים מפצים</td>
                  <td className="py-2 text-center font-mono font-semibold">{kpi.compensating_factors_count ?? '—'}</td>
                </tr>
              </tbody>
            </table>

            {/* Executive Summary */}
            {executiveSummary && (
              <div className="border border-gray-200 rounded-lg p-5 bg-gray-50">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-gray-600" />
                  <h2 className="text-sm font-bold text-gray-800 tracking-wide">תקציר מנהלים — חוות דעת חיתומית</h2>
                </div>
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {executiveSummary}
                </div>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════
              דף 2: אימות זהות + תלושי שכר
          ═══════════════════════════════════════════════════ */}
          <div className="page-break px-12 pt-8 pb-8">
            <h2 className="text-lg font-black text-gray-900 border-b-2 border-gray-900 pb-2 mb-6 tracking-tight">
              דף 2 — אימות זהות ותיק הכנסה
            </h2>

            {/* Identity Verification */}
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3">אימות זהות לווים</h3>
            {[b1, b2].filter(Boolean).map((b, idx) => {
              // Look up identity lock for this borrower from identityVerification
              const idLock = idx === 0 ? identity.borrower1 : identity.borrower2;
              const idVerified = idLock?.lock_status === 'green' ||
                (idLock?.sources || []).some(s => (s.source || '').includes('תעודת') && s.status === 'verified') ||
                b.id_document_found === true;
              return b?.name ? (
                <div key={idx} className="mb-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-900 text-white px-4 py-2 text-sm font-semibold">
                      {idx === 0 ? 'לווה ראשי' : 'לווה שני'} — {b.name}
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-gray-200">
                          <td className="px-4 py-2 text-gray-600 font-medium w-1/4">מספר ת.ז</td>
                          <td className="px-4 py-2 font-mono">{b.id_number || b.id || idLock?.id_number || '—'}</td>
                          <td className="px-4 py-2 text-gray-600 font-medium w-1/4">מעסיק</td>
                          <td className="px-4 py-2">{b.employer || '—'}</td>
                        </tr>
                        <tr className="border-b border-gray-200">
                          <td className="px-4 py-2 text-gray-600 font-medium">סוג תעסוקה</td>
                          <td className="px-4 py-2">{b.employment_type || '—'}</td>
                          <td className="px-4 py-2 text-gray-600 font-medium">ותק</td>
                          <td className="px-4 py-2">{b.seniority_years ? `${b.seniority_years} שנים` : '—'}</td>
                        </tr>
                        <tr className="border-b border-gray-200">
                          <td className="px-4 py-2 text-gray-600 font-medium">הכנסה חודשית נטו</td>
                          <td className="px-4 py-2 font-mono font-bold">{fmt(b.monthly_income)}</td>
                          <td className="px-4 py-2 text-gray-600 font-medium">סטטוס אימות ת.ז</td>
                          <td className="px-4 py-2">
                            {idVerified
                              ? <span className="text-green-700 font-semibold">✓ אומת</span>
                              : <span className="text-amber-600 font-semibold">~ חלקי</span>}
                          </td>
                        </tr>
                        {b.birth_date && (
                          <tr>
                            <td className="px-4 py-2 text-gray-600 font-medium">תאריך לידה</td>
                            <td className="px-4 py-2">{b.birth_date}</td>
                            <td className="px-4 py-2 text-gray-600 font-medium">גיל</td>
                            <td className="px-4 py-2">{b.age ? `${b.age}` : '—'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null;
            })}

            {/* Identity lock sources — using actual scoreObject.identityVerification structure */}
            {identity.borrower1 && (
              <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">מקורות אימות זהות</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-200 px-3 py-2 text-right font-semibold">לווה</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">תעודת זהות</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">תלוש שכר</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">דף עו"ש</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">נעילה משולשת</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[identity.borrower1, identity.borrower2].filter(Boolean).map((bv, idx) => {
                      // Sources array: [{source: 'תעודת זהות'|'תלוש שכר'|'דפי חשבון', status: 'verified'|'missing'|'mismatch'}]
                      const getSource = (name) => (bv.sources || []).find(s => s.source === name || (s.source || '').includes(name));
                      const idSrc = getSource('תעודת זהות') || getSource('ת.ז');
                      const payslipSrc = getSource('תלוש שכר');
                      const bankSrc = getSource('דפי חשבון') || getSource('עו"ש') || getSource('דף');
                      const idOk = idSrc?.status === 'verified';
                      const payslipOk = payslipSrc?.status === 'verified';
                      const bankOk = bankSrc?.status === 'verified';
                      const tripleOk = bv.lock_status === 'green';
                      return (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="border border-gray-200 px-3 py-2 font-medium">{bv.borrower_name || bv.name || `לווה ${idx + 1}`}</td>
                          <td className="border border-gray-200 px-3 py-2 text-center">{idOk ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-400">—</span>}</td>
                          <td className="border border-gray-200 px-3 py-2 text-center">{payslipOk ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-400">—</span>}</td>
                          <td className="border border-gray-200 px-3 py-2 text-center">{bankOk ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-400">—</span>}</td>
                          <td className="border border-gray-200 px-3 py-2 text-center font-bold">
                            {tripleOk
                              ? <span className="text-green-700">✓ נעול</span>
                              : bv.lock_status === 'yellow' ? <span className="text-amber-600">חלקי</span>
                              : <span className="text-red-600">כשל</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Payslip table */}
            {payslipDocs.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3 mt-6">פירוט תלושי שכר</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-900 text-white">
                      <th className="border border-gray-700 px-2 py-2 text-right font-semibold">חודש</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">לווה</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">מעסיק</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">ברוטו</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">נטו</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">מס הכנסה</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">ביטוח לאומי</th>
                      <th className="border border-gray-700 px-2 py-2 font-semibold">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslipDocs.map((doc, i) => {
                      const d = doc.extracted_data || {};
                      return (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="border border-gray-200 px-2 py-1.5 font-medium">{doc.month_year || d.month_year || '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5">{d.employee_name || d.borrower_name || '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5">{d.employer || d.employer_name || '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5 text-center font-mono">{d.gross_salary ? fmt(d.gross_salary) : '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5 text-center font-mono font-bold">{d.net_salary ? fmt(d.net_salary) : '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5 text-center font-mono">{d.tax_deduction ? fmt(d.tax_deduction) : '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5 text-center font-mono">{d.social_security ? fmt(d.social_security) : '—'}</td>
                          <td className="border border-gray-200 px-2 py-1.5 text-center">
                            {doc.overall_status === 'verified'
                              ? <span className="text-green-700 font-bold text-[10px]">✓ אומת</span>
                              : doc.overall_status === 'mismatch'
                              ? <span className="text-red-600 font-bold text-[10px]">✗ חוסר</span>
                              : <span className="text-gray-400 text-[10px]">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════
              דף 3: התחייבויות + עו"ש
          ═══════════════════════════════════════════════════ */}
          <div className="page-break px-12 pt-8 pb-10">
            <h2 className="text-lg font-black text-gray-900 border-b-2 border-gray-900 pb-2 mb-6 tracking-tight">
              דף 3 — פרופיל פיננסי, התחייבויות ועו"ש
            </h2>

            {/* Liabilities */}
            {kpi.liability_breakdown?.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3">ריכוז התחייבויות</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-900 text-white">
                      <th className="border border-gray-700 px-3 py-2 text-right font-semibold">תיאור</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">סוג</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">החזר חודשי</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">יתרה</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">סיום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpi.liability_breakdown.map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-200 px-3 py-1.5 font-medium">{item.name || item.description || '—'}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">{item.type || '—'}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center font-mono font-bold">{fmt(item.monthly_payment)}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center font-mono">{fmt(item.balance)}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">{item.end_date || (item.remaining_months ? `${item.remaining_months} חו'` : '—')}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold">
                      <td className="border border-gray-300 px-3 py-2" colSpan={2}>סה"כ</td>
                      <td className="border border-gray-300 px-3 py-2 text-center font-mono">{fmt(kpi.total_liabilities)}</td>
                      <td className="border border-gray-300 px-3 py-2" colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Bank Statements summary */}
            {bankDocs.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3">סיכום דפי עו"ש</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-900 text-white">
                      <th className="border border-gray-700 px-3 py-2 text-right font-semibold">תקופה</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">בנק</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">מס' חשבון</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">ממוצע זכות</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">ממוצע חובה</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">יתרה סופית</th>
                      <th className="border border-gray-700 px-3 py-2 font-semibold">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankDocs.map((doc, i) => {
                      const d = doc.extracted_data || {};
                      return (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="border border-gray-200 px-3 py-1.5">{doc.month_year || '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5">{d.bank_name || '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5 font-mono">{d.account_number || d.account_last4 || '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5 text-center font-mono">{d.avg_credit ? fmt(d.avg_credit) : '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5 text-center font-mono">{d.avg_debit ? fmt(d.avg_debit) : '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5 text-center font-mono font-bold">{d.ending_balance != null ? fmt(d.ending_balance) : '—'}</td>
                          <td className="border border-gray-200 px-3 py-1.5 text-center">
                            {doc.overall_status === 'verified'
                              ? <span className="text-green-700 font-bold text-[10px]">✓ אומת</span>
                              : <span className="text-gray-400 text-[10px]">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Checklist */}
            {checklist.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-3">רשימת תיעוד (Checklist)</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-200 px-3 py-2 text-right font-semibold">מסמך</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">קטגוריה</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold">סטטוס</th>
                      <th className="border border-gray-200 px-3 py-2 font-semibold text-right">הערות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-200 px-3 py-1.5 font-medium">{item.label || item.document || '—'}</td>
                        <td className="border border-gray-200 px-3 py-1.5">{item.category || '—'}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">
                          {item.status === 'present' || item.status === 'valid'
                            ? <span className="text-green-700 font-bold">✓ קיים</span>
                            : item.status === 'missing'
                            ? <span className="text-red-600 font-bold">✗ חסר</span>
                            : item.status === 'partial'
                            ? <span className="text-amber-600 font-bold">~ חלקי</span>
                            : <span className="text-gray-400">{item.status || '—'}</span>}
                        </td>
                        <td className="border border-gray-200 px-3 py-1.5 text-gray-500">{item.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-400">
              <span>מיקוד משכנתאות — מרכז חיתום מוסדי | Office@mikud4me.co.il</span>
              <span>תיק {caseNumber} | הופק: {today}</span>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════
              נספחים: מסמכי מקור — ת.ז → תלושים → עו"ש
          ═══════════════════════════════════════════════════ */}
          {appendixDocs.length === 0 && (
            <div className="page-break px-12 pt-8 pb-8">
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-6 text-center">
                <p className="text-amber-700 font-semibold text-sm mb-1">לא נמצאו קבצי מסמכים לנספח</p>
                <p className="text-amber-600 text-xs">המסמכים אינם מקושרים לתיק זה או שהועלו ללא URL</p>
              </div>
            </div>
          )}
          {appendixDocs.map((doc, i) => {
            const typeLabel = DOC_TYPE_LABEL[doc.document_type] || DOC_TYPE_LABEL.other;
            const borrowerName = doc.extracted_data?.employee_name
              || doc.extracted_data?.borrower_name
              || doc.borrower_id
              || '';
            const period = doc.month_year ? ` — ${doc.month_year}` : '';
            const title = `נספח ${i + 1}: ${typeLabel}${borrowerName ? ' — ' + borrowerName : ''}${period}`;
            const fileUrl = resolveUrl(doc);

            return (
              <div key={doc.id || i} className="page-break px-12 pt-8 pb-8">
                {/* Appendix header */}
                <div className="flex items-center justify-between border-b border-gray-300 pb-2 mb-4">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{title}</span>
                  <span className="text-xs text-gray-400">תיק {caseNumber}</span>
                </div>

                {/* Document render */}
                {isPdf(fileUrl) ? (
                  <div>
                    <embed
                      src={fileUrl}
                      type="application/pdf"
                      className="w-full border border-gray-200 rounded"
                      style={{ height: '250mm' }}
                    />
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center mt-2 text-blue-600 underline text-sm font-semibold"
                    >
                      לחץ כאן לפתיחת המסמך בטאב חדש
                    </a>
                  </div>
                ) : (
                  <div>
                    <img
                      src={fileUrl}
                      alt={title}
                      className="max-w-full object-contain rounded border border-gray-200"
                      style={{ maxHeight: '270mm' }}
                      onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                    />
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden text-center mt-2 text-blue-600 underline text-sm font-semibold"
                    >
                      לחץ כאן לפתיחת המסמך החסר בטאב חדש
                    </a>
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </div>

      {/* Print CSS for appendix media */}
      <style>{`
        @media print {
          iframe, img { max-width: 100% !important; max-height: 270mm !important; page-break-inside: avoid !important; }
        }
      `}</style>
    </>
  );
}