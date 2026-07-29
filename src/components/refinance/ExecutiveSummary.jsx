import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Target, DollarSign, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function ExecutiveSummary({ analysisResult, headline, externalTrigger, onTriggerDone }) {
  const printRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (externalTrigger) {
      handlePrint().then(() => onTriggerDone?.());
    }
  }, [externalTrigger]);

  if (!analysisResult) return null;

  const { currentLoan, savings, surgicalAnalysis, newLoan, mixes, conclusionText, partialRefinanceSavings, snapshotHeader, dualStrategy } = analysisResult;
  const strategy = surgicalAnalysis?.strategy || { title: 'מחזור מלא', type: 'FULL', description: 'מחזור כל המסלולים' };

  const clientName = currentLoan?.borrowers_names?.join(' ו-') || 'הלקוח';
  const isSurgical = strategy?.type === 'SURGICAL';
  const partialSavings = analysisResult?.partialRefinanceSavings;

  // ── חיסכון חודשי: עבור כירורגי — ההפרש על המסלולים הרעילים ──
  const monthlyFreed = isSurgical && partialSavings ? partialSavings.monthlySavings : (savings?.monthlySavings || 0);

  // ── netSavings: מגיע מ-FINAL_NET בבאקאנד — מספר אחד עקבי (headline הוא מקור האמת) ──
  const netSavings = headline?.netSavings || 0;
  const surgicalNetSavings = isSurgical && partialSavings ? partialSavings.netSavings : null;

  const earlyRepaymentFee = savings?.earlyRepaymentFee || 0;
  const bankFees = savings?.bankFees || 360;
  const breakEvenMonths = isSurgical && partialSavings ? partialSavings.breakEvenMonths : (savings?.breakEvenMonths || 0);
  // indexDamage = נזק מדד Lifetime (מחושב בbackend על כל תקופת המסלולים הצמודים)
  const indexDamage = savings?.indexDamageAlerts?.reduce((s, a) => s + (a.indexDamage || 0), 0) || 0;
  const externalDebts = savings?.equityReleaseAnalysis?.externalDebts || [];
  const cashFlowImprovement = savings?.equityReleaseAnalysis?.monthlyCashFlowImprovement || monthlyFreed;
  const goldenCount = surgicalAnalysis?.goldenCount || 0;
  const isWorthwhile = savings?.isWorthwhile;
  const today = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });

  const trackColors = ['#C5A059', '#2563eb', '#16a34a', '#7c3aed'];

  const riskLabels = {
    conservative: { label: 'שמרני 🛡️', color: '#475569' },
    balanced: { label: 'מאוזן ⚖️', color: '#b45309' },
    aggressive: { label: 'אגרסיבי 🚀', color: '#15803d' },
  };

  const handlePrint = async () => {
    if (!printRef.current) return;
    setIsGenerating(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const clientNameSafe = (clientName || 'לקוח').replace(/[^א-תa-zA-Z0-9 ]/g, '');
      await html2pdf()
        .set({
          margin: [8, 6, 8, 6],
          filename: `דוח_מחזור_${clientNameSafe}.pdf`,
          image: { type: 'jpeg', quality: 0.97 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 740,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        })
        .from(printRef.current)
        .save();
    } catch (e) {
      console.error('PDF error:', e);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── styles ──
  const S = {
    page: { padding: '28px 32px', background: 'white', fontFamily: "'Heebo', Arial, sans-serif", direction: 'rtl', color: '#0f172a' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #0f172a', paddingBottom: '16px', marginBottom: '24px' },
    sectionTitle: (color = '#0f172a') => ({ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }),
    accent: (color) => ({ width: '4px', height: '24px', background: color, borderRadius: '4px', flexShrink: 0 }),
    h3: { fontSize: '14px', fontWeight: '800', color: '#0f172a', margin: 0 },
    box: (bg, border) => ({ background: bg, border: `1.5px solid ${border}`, borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }),
    stat: { textAlign: 'center', padding: '12px 8px' },
    statLabel: { fontSize: '9px', color: '#64748b', marginBottom: '3px' },
    statValue: (color = '#0f172a') => ({ fontSize: '18px', fontWeight: '900', color }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' },
    th: { padding: '8px 12px', background: '#0f172a', color: 'white', fontWeight: '700', textAlign: 'right' },
    td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#334155' },
    tdCenter: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', color: '#334155' },
    mixCard: (isRec) => ({
      border: isRec ? '2.5px solid #C5A059' : '1.5px solid #e2e8f0',
      borderRadius: '10px',
      overflow: 'hidden',
      background: isRec ? '#fffbeb' : '#f8fafc',
      pageBreakInside: 'avoid',
    }),
    mixHeader: (isRec) => ({
      background: isRec ? 'linear-gradient(90deg, #B8922A, #D4AF37)' : '#1e293b',
      padding: '10px 14px',
      color: isRec ? '#0A192F' : 'white',
      fontWeight: '800',
      fontSize: '13px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }),
    pageBreak: { pageBreakBefore: 'always', height: '1px' },
  };

  return (
    <div className="space-y-3 -mt-2">
      {/* ── תוצאת הביניים — המשך ישיר לשתי האסטרטגיות, לא כרטיס נפרד ── */}
      <div className="border-t border-[#C5A059]/15 pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-[#8892B0] uppercase tracking-wider flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-[#D4AF37]" />
            השורה התחתונה
          </span>
          <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${isWorthwhile ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
            {isWorthwhile ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {isWorthwhile ? 'כדאי למחזר' : 'כדאיות גבולית'}
          </div>
        </div>

        {/* Trinity View — שלושת עמודי הוודאות */}
        <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3">
          {/* עמוד 1: Index Shield */}
          <div className="bg-gradient-to-br from-emerald-600 to-green-700 rounded-xl p-2 md:p-4 text-white flex flex-col items-center text-center">
            <p className="text-[9px] md:text-xs font-bold opacity-80 mb-1">🛡️ מגן מדד</p>
            <p className="text-base md:text-3xl font-black leading-tight">₪{indexDamage.toLocaleString()}</p>
            <p className="text-[8px] md:text-xs opacity-70 mt-1 hidden md:block">חיסכון מהצמדה לאורך כל התקופה</p>
          </div>
          {/* עמוד 2: חיסכון חודשי / מקדמה */}
          {monthlyFreed < 0 ? (
            <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl p-2 md:p-4 text-white flex flex-col items-center text-center">
              <p className="text-[9px] md:text-xs font-bold opacity-80 mb-1">⚠️ מקדמה</p>
              <p className="text-base md:text-3xl font-black leading-tight">+₪{Math.abs(monthlyFreed).toLocaleString()}</p>
              <p className="text-[8px] md:text-xs opacity-70 mt-1 hidden md:block">₪/חודש יותר — נמס מול ₪{indexDamage.toLocaleString()} מגן מדד</p>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-2 md:p-4 text-white flex flex-col items-center text-center">
              <p className="text-[9px] md:text-xs font-bold opacity-80 mb-1">💙 חיסכון חודשי</p>
              <p className="text-base md:text-3xl font-black leading-tight">₪{monthlyFreed.toLocaleString()}</p>
              <p className="text-[8px] md:text-xs opacity-70 mt-1 hidden md:block">פחות מהעו"ש כל חודש</p>
            </div>
          )}
          {/* עמוד 3: Bottom Line */}
          <div className="bg-gradient-to-br from-[#C5A059] to-[#917642] rounded-xl p-2 md:p-4 text-[#0A192F] flex flex-col items-center text-center">
            <p className="text-[9px] md:text-xs font-black opacity-80 mb-1">💰 רווח נטו</p>
            <p className="text-base md:text-3xl font-black leading-tight">₪{netSavings.toLocaleString()}</p>
            <p className="text-[8px] md:text-xs opacity-70 mt-1 hidden md:block">השורה התחתונה שנשארת בכיס</p>
          </div>
        </div>
        {/* Strategy tag */}
        <div className="text-center text-xs text-[#C5A059] font-bold opacity-80 mb-3">
          {strategy.title} · {strategy.description}
        </div>

        {/* ── PDF trigger button (small, internal) ── */}
        <div className="flex justify-end">
          <Button onClick={handlePrint} disabled={isGenerating} variant="outline" size="sm"
            className="border-[#C5A059]/60 text-[#C5A059] hover:bg-[#C5A059]/10 gap-2">
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {isGenerating ? 'מייצר...' : 'הורד דוח מלא'}
          </Button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          PRINTABLE REPORT — hidden off-screen
      ══════════════════════════════════════════════ */}
      <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '740px' }}>
        <div ref={printRef} style={{ background: 'white', fontFamily: "'Heebo', Arial, sans-serif", direction: 'rtl', color: '#0f172a', width: '740px' }}>

          {/* ════ PAGE 1: OVERVIEW ════ */}
          <div style={S.page}>

            {/* Header */}
            <div style={S.header}>
              <div>
                <div style={{ fontSize: '9px', color: '#94a3b8', letterSpacing: '2px', marginBottom: '2px' }}>MIKUD MORTGAGES · מיקוד משכנתאות</div>
                <div style={{ fontSize: '20px', fontWeight: '900' }}>דו"ח אופטימיזציה פיננסית</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>בחינת כדאיות מחזור משכנתא</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>הופק עבור</div>
                <div style={{ fontSize: '13px', fontWeight: '800' }}>{clientName}</div>
                <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '4px' }}>תאריך</div>
                <div style={{ fontSize: '11px', fontWeight: '700' }}>{today}</div>
              </div>
            </div>

            {/* ══ SNAPSHOT HEADER: LTV + PTI + Key Stats ══ */}
            {snapshotHeader && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
                {[
                  {
                    label: 'אחוז מימון (LTV)',
                    value: snapshotHeader.ltv ? `${snapshotHeader.ltv}%` : 'לא זמין',
                    sub: snapshotHeader.ltvStatus === 'excellent' ? '✅ מצוין — מתחת ל-45%' : snapshotHeader.ltvStatus === 'good' ? '✅ טוב' : snapshotHeader.ltvStatus === 'acceptable' ? '⚠️ סביר' : '🔴 גבוה',
                    color: snapshotHeader.ltvStatus === 'excellent' || snapshotHeader.ltvStatus === 'good' ? '#15803d' : snapshotHeader.ltvStatus === 'acceptable' ? '#b45309' : '#dc2626',
                    bg: snapshotHeader.ltvStatus === 'excellent' || snapshotHeader.ltvStatus === 'good' ? '#f0fdf4' : '#fffbeb',
                    border: snapshotHeader.ltvStatus === 'excellent' || snapshotHeader.ltvStatus === 'good' ? '#bbf7d0' : '#fde68a',
                  },
                  {
                    label: 'יתרה לסילוק',
                    value: `₪${snapshotHeader.remainingBalance?.toLocaleString()}`,
                    sub: 'קרן להלוואה חדשה',
                    color: '#0f172a', bg: '#f8fafc', border: '#e2e8f0',
                  },
                  {
                    label: 'ריבית ממוצעת נוכחית',
                    value: `${currentLoan?.averageInterestRate?.toFixed(2)}%`,
                    sub: `אפקטיבית: ${currentLoan?.effectiveInterestRate?.toFixed(2)}%`,
                    color: '#dc2626', bg: '#fff5f5', border: '#fecaca',
                  },
                  {
                    label: 'ריבית חדשה (שוק)',
                    value: `${headline?.newAverageRate?.toFixed(2)}%`,
                    sub: 'ממוצע תמהיל מומלץ',
                    color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',
                  },
                ].map((item, i) => (
                  <div key={i} style={{ background: item.bg, border: `1.5px solid ${item.border}`, borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '8px', color: '#64748b', marginBottom: '3px' }}>{item.label}</div>
                    <div style={{ fontSize: '18px', fontWeight: '900', color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: '8px', color: '#64748b', marginTop: '2px' }}>{item.sub}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Verdict banner */}
            <div style={{
              background: isWorthwhile ? 'linear-gradient(135deg,#15803d,#16a34a)' : 'linear-gradient(135deg,#b45309,#d97706)',
              borderRadius: '10px', padding: '14px 20px', color: 'white', marginBottom: '20px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.85 }}>המלצה</div>
                <div style={{ fontSize: '16px', fontWeight: '900' }}>{isWorthwhile ? '✅ מחזור משכנתא משתלם!' : '⚠️ כדאיות גבולית — בחן בקפידה'}</div>
                <div style={{ fontSize: '11px', opacity: 0.9, marginTop: '4px' }}>{strategy.title} · {strategy.description}</div>
              </div>
              <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', padding: '10px 18px' }}>
              <div style={{ fontSize: '9px', opacity: 0.8 }}>חיסכון כלכלי נטו מקסימלי</div>
              <div style={{ fontSize: '24px', fontWeight: '900' }}>₪{netSavings.toLocaleString()}</div>
              {indexDamage > 0 && (
                <div style={{ fontSize: '8px', opacity: 0.8, marginTop: '2px' }}>כולל ₪{indexDamage.toLocaleString()} מגן מדד Lifetime מלא</div>
              )}
              </div>
            </div>

            {/* Before / After grid */}
            <div style={S.sectionTitle()}>
              <div style={S.accent('#0f172a')}></div>
              <span style={S.h3}>א. המצב הנוכחי מול המצב החדש</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              <div style={S.box('#fff5f5', '#fecaca')}>
                <div style={{ fontSize: '11px', fontWeight: '800', color: '#dc2626', marginBottom: '10px' }}>❌ לפני המחזור</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    ['החזר חודשי', `₪${headline?.currentMonthlyPayment?.toLocaleString()}`, '#dc2626'],
                    ['יתרה לסילוק', `₪${currentLoan?.remainingBalance?.toLocaleString()}`, '#0f172a'],
                    ['ריבית ממוצעת', `${headline?.currentAverageRate?.toFixed(2)}%`, '#dc2626'],
                    ['ריבית אפקטיבית', `${(currentLoan?.effectiveInterestRate || currentLoan?.averageInterestRate)?.toFixed(2)}%`, '#7c3aed'],
                  ].map(([label, val, color], i) => (
                    <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '8px 10px', border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: '8px', color: '#64748b' }}>{label}</div>
                      <div style={{ fontSize: '14px', fontWeight: '900', color }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={S.box('#f0fdf4', '#bbf7d0')}>
                <div style={{ fontSize: '11px', fontWeight: '800', color: '#16a34a', marginBottom: '10px' }}>✅ אחרי המחזור</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    ['החזר חודשי חדש', `₪${headline?.newMonthlyPayment?.toLocaleString()}`, '#16a34a'],
                    [
                      monthlyFreed <= 0 && !isSurgical ? 'הפרש חודשי (עולה)' : 'חיסכון חודשי',
                      isSurgical ? `₪${monthlyFreed.toLocaleString()}/חודש` : (monthlyFreed < 0 ? `↑ ₪${Math.abs(monthlyFreed).toLocaleString()}` : `₪${monthlyFreed.toLocaleString()}`),
                      monthlyFreed > 0 ? '#16a34a' : '#d97706'
                    ],
                    ['ריבית חדשה', `${headline?.newAverageRate?.toFixed(2)}%`, '#16a34a'],
                    ['נקודת איזון', `${breakEvenMonths} חודשים`, '#0f172a'],
                  ].map(([label, val, color], i) => (
                    <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '8px 10px', border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: '8px', color: '#64748b' }}>{label}</div>
                      <div style={{ fontSize: '14px', fontWeight: '900', color }}>{val}</div>
                    </div>
                  ))}
                </div>
                {monthlyFreed < 0 && (
                  <div style={{ marginTop: '10px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 10px', fontSize: '10px', color: '#92400e', lineHeight: '1.5' }}>
                    💡 ההחזר החודשי עולה מעט, אך החיסכון מגיע מ<strong>ביטול ההצמדה למדד</strong> — שמונע תייקור שנתי של אלפי שקלים לאורך השנים.
                  </div>
                )}
              </div>
            </div>

            {/* ══ DUAL STRATEGY TABLE ══ */}
            {dualStrategy && (
              <div style={{ marginBottom: '20px' }}>
                <div style={S.sectionTitle()}>
                  <div style={S.accent('#7c3aed')}></div>
                  <span style={S.h3}>ב. בחירה אסטרטגית — שני מסלולי פעולה</span>
                </div>
                <table style={{ ...S.table, border: '1.5px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                  <thead>
                    <tr>
                      {['פרמטר', `${dualStrategy.strategyA.icon} ${dualStrategy.strategyA.label}`, `${dualStrategy.strategyB.icon} ${dualStrategy.strategyB.label}`].map((h, i) => (
                        <th key={i} style={{ ...S.th, background: i === 1 ? '#1e3a5f' : i === 2 ? '#14532d' : '#0f172a', textAlign: i > 0 ? 'center' : 'right', fontSize: '10px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['החזר חודשי חדש',
                        `₪${dualStrategy.strategyA.monthlyPayment?.toLocaleString()}`,
                        `₪${dualStrategy.strategyB.monthlyPayment?.toLocaleString()}`],
                      ['שינוי בהחזר לעומת היום',
                        dualStrategy.strategyA.monthlyDelta > 0 ? `↑ ₪${dualStrategy.strategyA.monthlyDelta?.toLocaleString()}` : `↓ ₪${Math.abs(dualStrategy.strategyA.monthlyDelta)?.toLocaleString()}`,
                        dualStrategy.strategyB.monthlyDelta > 0 ? `↑ ₪${dualStrategy.strategyB.monthlyDelta?.toLocaleString()}` : `↓ ₪${Math.abs(dualStrategy.strategyB.monthlyDelta)?.toLocaleString()}`],
                      ['שנים שנותרות',
                        `${dualStrategy.strategyA.periodYears} שנים${dualStrategy.strategyA.yearsShortened > 0 ? ` (קיצור ${dualStrategy.strategyA.yearsShortened} שנים)` : ''}`,
                        `${dualStrategy.strategyB.periodYears} שנים`],
                      ['חיסכון נטו (שורה תחתונה)',
                        `₪${dualStrategy.strategyA.netSavings?.toLocaleString()}`,
                        (dualStrategy.strategyB.netSavings || 0) >= 0 
                          ? `₪${dualStrategy.strategyB.netSavings?.toLocaleString()}`
                          : `עלות +₪${Math.abs(dualStrategy.strategyB.netSavings || 0).toLocaleString()}`],
                      ['מתאים ל...',
                        dualStrategy.strategyA.suitedFor,
                        dualStrategy.strategyB.suitedFor],
                    ].map(([label, valA, valB], i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                        <td style={{ ...S.td, fontWeight: '700', fontSize: '10px' }}>{label}</td>
                        <td style={{ ...S.tdCenter, fontWeight: i === 3 ? '900' : '600', color: i === 3 ? '#1d4ed8' : i === 1 ? (dualStrategy.strategyA.monthlyDelta > 0 ? '#d97706' : '#16a34a') : '#0f172a', fontSize: '10px' }}>{valA}</td>
                        <td style={{ ...S.tdCenter, fontWeight: i === 3 ? '900' : '600', color: i === 3 ? '#15803d' : i === 1 ? (dualStrategy.strategyB.monthlyDelta > 0 ? '#d97706' : '#16a34a') : '#0f172a', fontSize: '10px' }}>{valB}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Savings timeline */}
            <div style={{ background: monthlyFreed >= 0 ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#1e3a5f,#0f172a)', borderRadius: '10px', padding: '16px 20px', color: 'white', marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', opacity: 0.85, marginBottom: '6px' }}>
                {monthlyFreed >= 0 ? '💚 הכסף שיחזור לכיסך' : '🔥 חיסכון מביטול הצמדה למדד'}
              </div>
              {monthlyFreed < 0 && (
                <div style={{ fontSize: '10px', opacity: 0.85, marginBottom: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px' }}>
                  ההחזר החודשי עולה ב-₪{Math.abs(monthlyFreed).toLocaleString()}, אך החיסכון הגדול נובע מביטול ההצמדה למדד שמכרסמת בחוב לאורך השנים.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', textAlign: 'center' }}>
                {[
                  [monthlyFreed >= 0 ? 'חיסכון חודשי' : 'הפרש חודשי', monthlyFreed >= 0 ? `₪${monthlyFreed.toLocaleString()}` : `↑₪${Math.abs(monthlyFreed).toLocaleString()}`],
                  ['נזק מדד נמנע', `₪${indexDamage.toLocaleString()}`],
                  ['5 שנים (מדד)', `₪${Math.abs(monthlyFreed * 60 + indexDamage * (5 / Math.max((currentLoan?.remainingMonths || 240) / 12, 1))).toLocaleString()}`],
                  ['סה"כ נטו', `₪${netSavings.toLocaleString()}`],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize: '9px', opacity: 0.8 }}>{label}</div>
                    <div style={{ fontSize: '16px', fontWeight: '900' }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Costs */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              {[
                ['עמלת פירעון מוקדם', `₪${earlyRepaymentFee.toLocaleString()}`, '#fef3c7', '#f59e0b'],
                ['עמלות בנק / עורך דין', `₪${bankFees.toLocaleString()}`, '#fef3c7', '#f59e0b'],
                ['סה"כ עלות מחזור', `₪${(earlyRepaymentFee + bankFees).toLocaleString()}`, '#fee2e2', '#ef4444'],
                ['נקודת איזון', `${breakEvenMonths} חודש`, '#eff6ff', '#2563eb'],
              ].map(([label, val, bg, color], i) => (
                <div key={i} style={{ flex: 1, background: bg, border: `1px solid ${color}40`, borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '8px', color: '#64748b', marginBottom: '2px' }}>{label}</div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Existing tracks */}
            {currentLoan?.tracks?.length > 0 && (
              <>
                <div style={S.sectionTitle()}>
                  <div style={S.accent('#7c3aed')}></div>
                  <span style={S.h3}>ג. פירוט המסלולים הקיימים — Golden vs. Toxic</span>
                </div>
                <table style={{ ...S.table, marginBottom: '20px' }}>
                  <thead>
                    <tr>
                      {['סוג מסלול', 'יתרה', 'ריבית', 'ריבית אפקטיבית', 'חודשים', 'הצמדה', 'סטטוס'].map((h, i) => (
                        <th key={i} style={{ ...S.th, textAlign: i > 0 ? 'center' : 'right', fontSize: '9px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentLoan.tracks.map((t, i) => {
                      const statusMap = { GOLDEN: { label: '⭐ נכס זהב', bg: '#fef9c3', color: '#92400e' }, TOXIC: { label: '🔴 רעיל', bg: '#fee2e2', color: '#dc2626' }, NEUTRAL: { label: '⚪ גבולי', bg: '#f1f5f9', color: '#475569' } };
                      const st = statusMap[t.status] || statusMap['NEUTRAL'];
                      return (
                        <tr key={i} style={{ background: t.status === 'GOLDEN' ? '#fffbeb' : i % 2 === 0 ? 'white' : '#f8fafc' }}>
                          <td style={S.td}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: trackColors[i % trackColors.length], display: 'inline-block', flexShrink: 0 }}></span>
                              {t.track_type}
                            </span>
                          </td>
                          <td style={{ ...S.tdCenter, fontWeight: '700' }}>₪{t.remaining_balance?.toLocaleString()}</td>
                          <td style={{ ...S.tdCenter, fontWeight: '800', color: t.interest_rate > 5 ? '#dc2626' : '#16a34a' }}>{t.interest_rate?.toFixed(2)}%</td>
                          <td style={{ ...S.tdCenter, fontWeight: '800', color: '#7c3aed' }}>{t.effective_rate?.toFixed(2)}%</td>
                          <td style={S.tdCenter}>{t.remaining_months}</td>
                          <td style={{ ...S.tdCenter, color: t.is_index_linked ? '#d97706' : '#16a34a', fontWeight: '700', fontSize: '10px' }}>
                            {t.is_index_linked ? '🔴 צמוד' : '🟢 לא'}
                          </td>
                          <td style={{ ...S.tdCenter }}>
                            <span style={{ background: st.bg, color: st.color, borderRadius: '5px', padding: '2px 6px', fontSize: '9px', fontWeight: '800' }}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {/* Surgical explanation box */}
            {isSurgical && surgicalNetSavings !== null && (
              <div style={{ background: '#f0fdf4', border: '2px solid #86efac', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#15803d', marginBottom: '8px' }}>🔪 הסבר: מחזור כירורגי — מה מחזרים ומה שומרים?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ background: 'white', borderRadius: '8px', padding: '10px', border: '1.5px solid #bbf7d0' }}>
                    <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '3px' }}>🟢 מסלולים שנשמרים (נכסי זהב)</div>
                    {surgicalAnalysis?.goldenAssets?.map((t, i) => (
                      <div key={i} style={{ fontSize: '10px', fontWeight: '700', color: '#15803d' }}>
                        {t.track_type} — {t.interest_rate?.toFixed(2)}% | ₪{t.remaining_balance?.toLocaleString()}
                      </div>
                    ))}
                    <div style={{ fontSize: '9px', color: '#64748b', marginTop: '4px' }}>ריבית מעולה — לא כדאי לגעת</div>
                  </div>
                  <div style={{ background: 'white', borderRadius: '8px', padding: '10px', border: '1.5px solid #fecaca' }}>
                    <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '3px' }}>🔴 מסלולים שמוחלפים (יקרים)</div>
                    {surgicalAnalysis?.toxicTracks?.map((t, i) => (
                      <div key={i} style={{ fontSize: '10px', fontWeight: '700', color: '#dc2626' }}>
                        {t.track_type} — {t.interest_rate?.toFixed(2)}% | ₪{t.remaining_balance?.toLocaleString()}
                      </div>
                    ))}
                    <div style={{ fontSize: '9px', color: '#64748b', marginTop: '4px' }}>חיסכון: ₪{monthlyFreed.toLocaleString()}/חודש</div>
                  </div>
                </div>
                <div style={{ marginTop: '10px', fontSize: '10px', color: '#374151', lineHeight: '1.6', background: '#dcfce7', borderRadius: '6px', padding: '8px 10px' }}>
                  <strong>חיסכון כלכלי נטו מקסימלי: ₪{netSavings.toLocaleString()}</strong>
                  {indexDamage > 0 && ` — כולל ₪${indexDamage?.toLocaleString()} מגן מדד Lifetime (ריבית + הצמדה לכל תקופת המסלול)`}
                </div>
              </div>
            )}

            {/* Index damage alert */}
            {indexDamage > 0 && (
              <div style={{ background: '#fff5f5', border: '2px solid #fecaca', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: '#dc2626' }}>🔥 נזק הצמדה למדד — "האויב השקט"</div>
                    <div style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '4px', lineHeight: '1.5' }}>
                      המסלולים הצמודים למדד מוסיפים עלות נסתרת שאינה נראית בתשלום החודשי.<br />
                      המחזור יעצור נזק עתידי זה לחלוטין.
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#fef2f2', border: '2px solid #fecaca', borderRadius: '8px', padding: '10px 16px', flexShrink: 0, marginRight: '12px' }}>
                    <div style={{ fontSize: '9px', color: '#dc2626' }}>נזק מדד צפוי</div>
                    <div style={{ fontSize: '22px', fontWeight: '900', color: '#dc2626' }}>₪{indexDamage.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Expert conclusion */}
            {conclusionText && (
              <div style={{ background: '#0f172a', borderRadius: '10px', padding: '16px 20px', color: 'white' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '1px', marginBottom: '8px' }}>✦ חוות דעת מומחה</div>
                <div style={{ fontSize: '11.5px', lineHeight: '1.9', color: '#e2e8f0' }}>{conclusionText}</div>
              </div>
            )}

          </div>

          {/* ════ PAGE 2: 3 MIXES ════ */}
          {mixes?.length > 0 && (
            <>
              <div style={S.pageBreak}></div>
              <div style={S.page}>

                {/* Page header */}
                <div style={{ ...S.header, borderBottomColor: '#C5A059' }}>
                  <div>
                    <div style={{ fontSize: '9px', color: '#94a3b8', letterSpacing: '2px', marginBottom: '2px' }}>MIKUD MORTGAGES · מיקוד משכנתאות</div>
                    <div style={{ fontSize: '18px', fontWeight: '900' }}>תמהילי מחזור מומלצים</div>
                  </div>
                  <div style={{ textAlign: 'left', fontSize: '11px', color: '#64748b' }}>
                    <div>עבור: <strong>{clientName}</strong></div>
                    <div>יתרה: <strong>₪{currentLoan?.remainingBalance?.toLocaleString()}</strong></div>
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: '#475569', marginBottom: '20px', lineHeight: '1.6', background: '#f8fafc', borderRadius: '8px', padding: '10px 14px', border: '1px solid #e2e8f0' }}>
                  להלן 3 תמהילים מומלצים עבורכם, המחושבים על בסיס ריביות השוק העדכניות. כל תמהיל מייצג גישה שונה לאיזון בין יציבות לחיסכון. <strong>התמהיל המומלץ</strong> מסומן בזהב.
                </div>

                {/* Mix cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
                  {mixes.filter(Boolean).slice(0, 3).map((mix, idx) => {
                    const isRec = mix.mix_number === 2;
                    const rl = riskLabels[mix.risk_level] || { label: 'מותאם', color: '#0f172a' };
                    return (
                      <div key={idx} style={S.mixCard(isRec)}>
                        <div style={S.mixHeader(isRec)}>
                          <span>{mix.mix_name}</span>
                          {isRec && <span style={{ fontSize: '9px' }}>⭐ מומלץ</span>}
                        </div>
                        <div style={{ padding: '12px' }}>
                          <div style={{ fontSize: '9px', color: rl.color, fontWeight: '700', marginBottom: '6px' }}>{rl.label}</div>

                          {/* Monthly payment highlight */}
                          <div style={{ background: isRec ? '#fef9c3' : '#f1f5f9', borderRadius: '8px', padding: '10px', textAlign: 'center', marginBottom: '10px', border: isRec ? '1px solid #fde68a' : '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '8px', color: '#64748b' }}>החזר חודשי</div>
                            <div style={{ fontSize: '20px', fontWeight: '900', color: isRec ? '#92400e' : '#0f172a' }}>₪{mix.total_monthly_payment?.toLocaleString()}</div>
                            {mix.monthly_savings > 0 && (
                              <div style={{ fontSize: '9px', color: '#16a34a', fontWeight: '700', marginTop: '2px' }}>חיסכון: ₪{mix.monthly_savings?.toLocaleString()}/חודש</div>
                            )}
                          </div>

                          {mix.net_savings > 0 && (
                            <div style={{ textAlign: 'center', marginBottom: '10px', fontSize: '10px', color: '#16a34a', fontWeight: '800' }}>
                              חיסכון כולל: ₪{mix.net_savings.toLocaleString()}
                            </div>
                          )}

                          {/* Tracks */}
                          <div style={{ fontSize: '8px', color: '#64748b', fontWeight: '700', marginBottom: '4px' }}>פירוט מסלולים:</div>
                          {mix.tracks?.map((t, ti) => (
                            <div key={ti} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', background: 'white', borderRadius: '5px', marginBottom: '3px', border: '1px solid #f1f5f9' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: trackColors[ti % trackColors.length], flexShrink: 0 }}></div>
                                <div>
                                  <div style={{ fontSize: '8.5px', fontWeight: '700', color: '#0f172a', lineHeight: 1.2 }}>{t.track_type}</div>
                                  {t.period_years && <div style={{ fontSize: '7.5px', color: '#94a3b8' }}>{t.period_years} שנים</div>}
                                </div>
                              </div>
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: '10px', fontWeight: '900', color: '#0f172a' }}>{t.interest_rate?.toFixed(2)}%</div>
                                <div style={{ fontSize: '7.5px', color: '#94a3b8' }}>{t.percentage}%</div>
                              </div>
                            </div>
                          ))}

                          {/* Advantages */}
                          {mix.advantages?.length > 0 && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                              {mix.advantages.slice(0, 2).map((adv, ai) => (
                                <div key={ai} style={{ fontSize: '8px', color: '#475569', display: 'flex', gap: '4px', marginBottom: '3px', lineHeight: '1.4' }}>
                                  <span style={{ color: '#16a34a', flexShrink: 0 }}>✓</span>
                                  <span>{adv}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Comparison table */}
                <div style={S.sectionTitle()}>
                  <div style={S.accent('#2563eb')}></div>
                  <span style={S.h3}>השוואת תמהילים</span>
                </div>
                <table style={{ ...S.table, marginBottom: '20px' }}>
                  <thead>
                    <tr>
                      {['תמהיל', 'רמת סיכון', 'החזר חודשי', 'חיסכון חודשי', 'חיסכון כולל', 'תקופה'].map((h, i) => (
                        <th key={i} style={{ ...S.th, textAlign: i > 0 ? 'center' : 'right', fontSize: '10px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mixes.filter(Boolean).slice(0, 3).map((mix, i) => {
                      const isRec = mix.mix_number === 2;
                      const periodYears = mix.tracks?.[0]?.period_years || 20;
                      const rl = riskLabels[mix.risk_level] || { label: 'מותאם', color: '#0f172a' };
                      return (
                        <tr key={i} style={{ background: isRec ? '#fffbeb' : i % 2 === 0 ? 'white' : '#f8fafc' }}>
                          <td style={{ ...S.td, fontWeight: isRec ? '800' : '600' }}>
                            {isRec && '⭐ '}{mix.mix_name}
                          </td>
                          <td style={{ ...S.tdCenter, color: rl.color, fontWeight: '700', fontSize: '10px' }}>{rl.label}</td>
                          <td style={{ ...S.tdCenter, fontWeight: '800' }}>₪{mix.total_monthly_payment?.toLocaleString()}</td>
                          <td style={{ ...S.tdCenter, fontWeight: '800', color: (mix.monthly_savings || 0) > 0 ? '#16a34a' : (mix.monthly_savings || 0) < 0 ? '#d97706' : '#64748b', fontSize: '9px' }}>
                            {(mix.monthly_savings || 0) > 0
                              ? `₪${(mix.monthly_savings || 0).toLocaleString()}`
                              : (mix.monthly_savings || 0) < 0
                                ? `+₪${Math.abs(mix.monthly_savings || 0).toLocaleString()} (חיסכון ארוך טווח)`
                                : `—`}
                          </td>
                          <td style={{ ...S.tdCenter, fontWeight: '800', color: (mix.net_savings || 0) >= 0 ? '#16a34a' : '#94a3b8', fontSize: (mix.net_savings || 0) < 0 ? '9px' : '11px' }}>
                            {(mix.net_savings || 0) >= 0 ? `₪${(mix.net_savings || 0).toLocaleString()}` : `—`}
                          </td>
                          <td style={S.tdCenter}>{periodYears} שנים</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Sensitivity analysis */}
                {savings?.sensitivityAnalysis && (
                  <>
                    <div style={S.sectionTitle()}>
                      <div style={S.accent('#f59e0b')}></div>
                      <span style={S.h3}>מבחן רגישות — חיסכון לפי תרחישי מדד</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                      {[
                        ['מדד נמוך (2%)', savings.sensitivityAnalysis.optimistic, '#16a34a'],
                        ['מדד צפוי (2.5%)', savings.sensitivityAnalysis.realistic, '#2563eb'],
                        ['מדד גבוה (3.5%)', savings.sensitivityAnalysis.pessimistic, '#d97706'],
                      ].map(([label, val, color]) => val && (
                        <div key={label} style={{ background: '#f8fafc', border: `1.5px solid ${color}40`, borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                          <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '4px' }}>{label}</div>
                          <div style={{ fontSize: '18px', fontWeight: '900', color }}>₪{val.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Footer */}
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94a3b8', marginTop: '20px' }}>
                  <span>מיקוד משכנתאות · *2324 · Office@mikud4me.co.il</span>
                  <span>דוח זה הופק אוטומטית ב-{today}</span>
                  <span>מסמך מקצועי — לשימוש הלקוח בלבד</span>
                </div>

              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}