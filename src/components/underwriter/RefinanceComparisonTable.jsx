import React from 'react';
import { TrendingDown, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * RefinanceComparisonTable
 * Displays Before vs. After comparison for refinance/debt-consolidation cases.
 * Receives `refinanceImpact` from scoreObject.refinanceImpact
 */
export default function RefinanceComparisonTable({ refinanceImpact, caseType }) {
  if (!refinanceImpact) return null;

  const {
    current_total_monthly,
    proposed_monthly_payment,
    monthly_savings,
    current_pti,
    improved_pti,
    net_income,
    liability_items,
    consolidated_loans,
    economic_justification,
  } = refinanceImpact;

  const savingsColor = monthly_savings > 0 ? '#16a34a' : '#dc2626';
  const ptiImproved = improved_pti < current_pti;

  const ptiColor = (pti) => {
    if (pti < 30) return '#16a34a';
    if (pti < 40) return '#ca8a04';
    return '#dc2626';
  };

  return (
    <div
      className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/30 rounded-2xl overflow-hidden shadow-xl shadow-black/40"
      dir="rtl"
    >
      {/* Header */}
      <div className="bg-gradient-to-l from-[#C5A059]/10 to-transparent border-b border-[#C5A059]/20 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-[#8892B0] text-xs uppercase tracking-widest">ניתוח השפעת המיחזור</p>
          <p className="text-white font-bold text-lg mt-0.5">
            Refinance Impact Analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-[#C5A059]" />
          <span className="text-xs text-[#8892B0] border border-[#C5A059]/30 px-2 py-0.5 rounded">
            {caseType === 'debt_consolidation' ? 'איחוד חובות' : 'מחזור משכנתא'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ── Before / After comparison cards ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">

          {/* BEFORE */}
          <div className="bg-[#080d16] border border-red-500/20 rounded-xl p-4">
            <p className="text-xs text-[#8892B0] uppercase tracking-widest mb-3">מצב קיים — לפני</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[#8892B0] text-sm">סך החזרים חודשיים</span>
                <span className="text-red-400 font-black font-mono text-lg">
                  ₪{Math.round(current_total_monthly).toLocaleString('he-IL')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#8892B0] text-sm">PTI נוכחי</span>
                <span
                  className="font-bold font-mono text-base"
                  style={{ color: ptiColor(current_pti) }}
                >
                  {current_pti?.toFixed(1)}%
                </span>
              </div>
              {liability_items?.length > 0 && (
                <div className="pt-2 border-t border-[#1e2d4a] space-y-1">
                  {liability_items.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className={`${consolidated_loans?.includes(item.label) ? 'line-through text-[#4a5568]' : 'text-[#8892B0]'}`}>
                        {item.label}
                      </span>
                      <span className={`font-mono ${consolidated_loans?.includes(item.label) ? 'line-through text-[#4a5568]' : 'text-white'}`}>
                        ₪{Math.round(item.monthly).toLocaleString('he-IL')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-[#C5A059]/10 border border-[#C5A059]/40 flex items-center justify-center">
              <ArrowLeft className="w-5 h-5 text-[#C5A059]" />
            </div>
            {monthly_savings > 0 && (
              <div className="text-center">
                <p className="text-emerald-400 font-black font-mono text-xl">
                  ₪{Math.round(monthly_savings).toLocaleString('he-IL')}
                </p>
                <p className="text-[#8892B0] text-xs">חיסכון חודשי</p>
              </div>
            )}
          </div>

          {/* AFTER */}
          <div className="bg-[#080d16] border border-emerald-500/20 rounded-xl p-4">
            <p className="text-xs text-[#8892B0] uppercase tracking-widest mb-3">מצב מוצע — אחרי</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[#8892B0] text-sm">החזר חודשי חדש</span>
                <span className="text-emerald-400 font-black font-mono text-lg">
                  ₪{Math.round(proposed_monthly_payment).toLocaleString('he-IL')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#8892B0] text-sm">PTI משופר</span>
                <span
                  className="font-bold font-mono text-base"
                  style={{ color: ptiColor(improved_pti) }}
                >
                  {improved_pti?.toFixed(1)}%
                </span>
              </div>
              {ptiImproved && (
                <div className="flex items-center gap-2 pt-2 border-t border-[#1e2d4a]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-400 text-xs">
                    שיפור של {(current_pti - improved_pti).toFixed(1)}% ב-PTI
                  </span>
                </div>
              )}
              {consolidated_loans?.length > 0 && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#C5A059] shrink-0" />
                  <span className="text-[#C5A059] text-xs">
                    {consolidated_loans.length} הלוואות נסגרות במסגרת המיחזור
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom-line savings bar ── */}
        <div
          className="rounded-xl p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          style={{
            background: monthly_savings > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            borderColor: monthly_savings > 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
          }}
        >
          <div>
            <p className="text-xs text-[#8892B0] uppercase tracking-widest mb-1">The Bottom Line — שורת הרווח</p>
            <p className="text-white font-bold text-sm">
              {monthly_savings > 0
                ? `שיפור תזרים חודשי של ₪${Math.round(monthly_savings).toLocaleString('he-IL')}`
                : `עלייה בהחזר חודשי של ₪${Math.round(Math.abs(monthly_savings)).toLocaleString('he-IL')}`
              }
            </p>
            {net_income > 0 && (
              <p className="text-[#4a5568] text-xs mt-0.5">
                מתוך הכנסה מאומתת של ₪{net_income.toLocaleString('he-IL')} — {((monthly_savings / net_income) * 100).toFixed(1)}% מהכנסת משק הבית
              </p>
            )}
          </div>
          <div className="text-left sm:text-right shrink-0">
            <p
              className="font-black font-mono text-3xl"
              style={{ color: savingsColor }}
            >
              {monthly_savings > 0 ? '+' : ''}₪{Math.round(monthly_savings).toLocaleString('he-IL')}
            </p>
            <p className="text-[#4a5568] text-xs">לחודש</p>
          </div>
        </div>

        {/* ── AI Economic Justification ── */}
        {economic_justification && (
          <div className="bg-[#080d16] border border-[#C5A059]/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg bg-[#C5A059]/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[#C5A059] text-xs font-bold">AI</span>
              </div>
              <div>
                <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-1">הצדקה כלכלית — לוועדת האשראי</p>
                <p className="text-[#c8d4e0] text-sm leading-relaxed italic">
                  "{economic_justification}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Consolidated loans list ── */}
        {consolidated_loans?.length > 0 && (
          <div className="border border-[#1e2d4a] rounded-xl overflow-hidden">
            <div className="bg-[#0d1524] px-4 py-2.5 border-b border-[#1e2d4a]">
              <p className="text-xs text-[#8892B0] uppercase tracking-widest">הלוואות שנסגרות במסגרת המיחזור</p>
            </div>
            <div className="divide-y divide-[#0d1524]">
              {consolidated_loans.map((loan, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-[#080d16]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-[#8892B0] text-sm line-through">{loan}</span>
                  <span className="text-emerald-400 text-xs mr-auto">נסגר</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}