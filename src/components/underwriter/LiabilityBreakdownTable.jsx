import React from 'react';
import { CreditCard, Banknote, Landmark, ArrowLeftRight, CheckCircle2, Sparkles, TrendingDown } from 'lucide-react';

/**
 * LiabilityBreakdownTable — טבלת פירוט ההתחייבויות.
 * מציגה כל הלוואה, כרטיס אשראי ומשכנתא קיימת בנפרד — קריטי לחתם בתיקי מחזור ואיחוד
 * כדי לראות מה בדיוק מתאחד/נסגר. פריטים המסומנים לסילוק מסומנים ויזואלית.
 */

const TYPE_CONFIG = {
  mortgage:    { icon: Landmark,   label: 'משכנתא',     color: 'text-[#C5A059]' },
  loan:        { icon: Banknote,   label: 'הלוואה',      color: 'text-blue-400' },
  credit_card: { icon: CreditCard, label: 'כרטיס אשראי', color: 'text-purple-400' },
};

const fmt = (n) => (n != null ? Math.round(n).toLocaleString('he-IL') : '—');

export default function LiabilityBreakdownTable({ kpi, caseType }) {
  const items = kpi?.liability_breakdown || [];
  if (!items.length) return null;

  const totalMonthly = items.reduce((s, i) => s + (i.monthly || 0), 0);
  const extinguishedMonthly = items.filter(i => i.marked_for_extinguishment).reduce((s, i) => s + (i.monthly || 0), 0);
  const proposedPayment = kpi?.proposed_monthly_payment || null;
  const isRefinance = caseType === 'refinance' || caseType === 'debt_consolidation';
  const solution = kpi?.proactive_solution || null;

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/18 rounded-2xl p-6 shadow-xl shadow-black/40" dir="rtl">
      {/* ── 🧠 Proactive Solution Bottom Line — שורת הכדאיות שהמנוע בנה לבד ── */}
      {solution && (
        <div className={`mb-6 rounded-2xl border p-5 ${
          solution.relief_is_positive
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-[#C5A059]/5'
            : 'border-amber-500/30 bg-amber-500/5'
        }`}>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-[#C5A059]" />
            <p className="text-[#C5A059] text-xs font-bold uppercase tracking-widest">פתרון החתם החכם — שורה תחתונה</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
            <div className="text-center bg-black/30 border border-red-500/20 rounded-xl px-3 py-3">
              <p className="text-[#8892B0] text-[11px]">החזר חודשי נוכחי</p>
              <p className="text-red-400 font-mono font-black text-xl mt-1">₪{fmt(solution.current_monthly)}</p>
            </div>
            <div className="text-center bg-black/30 border border-emerald-500/25 rounded-xl px-3 py-3 relative">
              <ArrowLeftRight className="w-4 h-4 text-[#C5A059] absolute -right-2 top-1/2 -translate-y-1/2 hidden sm:block" />
              <p className="text-[#8892B0] text-[11px]">החזר משוער לאחר איחוד</p>
              <p className="text-emerald-400 font-mono font-black text-xl mt-1">₪{fmt(solution.proposed_monthly)}</p>
            </div>
            <div className={`text-center rounded-xl px-3 py-3 border ${
              solution.relief_is_positive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <p className="text-[#8892B0] text-[11px] flex items-center justify-center gap-1">
                <TrendingDown className="w-3 h-3" /> הקלה חודשית
              </p>
              <p className={`font-mono font-black text-xl mt-1 ${solution.relief_is_positive ? 'text-emerald-400' : 'text-amber-400'}`}>
                {solution.relief_is_positive ? '₪' + fmt(solution.monthly_relief) : '—'}
              </p>
            </div>
          </div>
          <p className="text-[#cbd5e1] text-sm leading-relaxed mt-4 text-center font-semibold">{solution.bottom_line}</p>
          {solution.condition_note && (
            <p className="text-[#8892B0] text-xs leading-relaxed mt-2 text-center flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3 text-[#C5A059]" /> {solution.condition_note}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[#8892B0] text-xs uppercase tracking-widest">פירוט התחייבויות</p>
          <p className="text-white font-bold mt-0.5">רשימת חובות מלאה ({items.length})</p>
        </div>
        <div className="text-center bg-black/30 border border-[#C5A059]/20 rounded-xl px-4 py-2">
          <p className="text-[#8892B0] text-xs">סך החזרים חודשי</p>
          <p className="text-white font-black font-mono text-lg">₪{fmt(totalMonthly)}</p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item, i) => {
          const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.loan;
          const Icon = cfg.icon;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                item.marked_for_extinguishment
                  ? 'border-emerald-500/25 bg-emerald-500/5'
                  : 'border-[#1e2d4a] bg-[#080d16]'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-[#1e2d4a] flex items-center justify-center shrink-0">
                <Icon className={`w-4 h-4 ${cfg.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-semibold truncate">{item.label}</span>
                  <span className="text-[10px] text-[#8892B0] border border-[#1e2d4a] px-1.5 py-0.5 rounded">{cfg.label}</span>
                  {item.marked_for_extinguishment && (
                    <span className="text-[10px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> מסומן לסילוק
                    </span>
                  )}
                </div>
                {item.balance != null && item.balance > 0 && (
                  <p className="text-[#4a5568] text-xs mt-0.5 font-mono">יתרה: ₪{fmt(item.balance)}</p>
                )}
              </div>
              <div className="text-left shrink-0">
                <p className={`font-mono font-bold text-sm ${item.marked_for_extinguishment ? 'text-emerald-400/80 line-through' : 'text-white'}`}>
                  ₪{fmt(item.monthly)}
                </p>
                <p className="text-[#4a5568] text-[10px]">לחודש</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Refinance consolidation summary */}
      {isRefinance && extinguishedMonthly > 0 && proposedPayment && (
        <div className="mt-5 pt-4 border-t border-[#1e2d4a]">
          <div className="flex items-center gap-2 mb-3">
            <ArrowLeftRight className="w-4 h-4 text-[#C5A059]" />
            <p className="text-[#C5A059] text-xs font-bold uppercase tracking-wider">השפעת המחזור</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2.5">
              <p className="text-[#8892B0] text-[11px]">חובות שנסגרים</p>
              <p className="text-red-400 font-mono font-bold text-sm mt-1">₪{fmt(extinguishedMonthly)}</p>
            </div>
            <div className="bg-[#C5A059]/5 border border-[#C5A059]/20 rounded-lg px-3 py-2.5">
              <p className="text-[#8892B0] text-[11px]">החזר חדש משוער</p>
              <p className="text-[#C5A059] font-mono font-bold text-sm mt-1">₪{fmt(proposedPayment)}</p>
            </div>
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2.5">
              <p className="text-[#8892B0] text-[11px]">הקלה חודשית</p>
              <p className="text-emerald-400 font-mono font-bold text-sm mt-1">
                ₪{fmt(Math.max(0, extinguishedMonthly - proposedPayment))}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}