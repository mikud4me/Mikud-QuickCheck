import React from 'react';
import { Sparkles, TrendingDown, ArrowLeft } from 'lucide-react';

const fmt = (n) => `₪${Math.round(n || 0).toLocaleString('he-IL')}`;

/**
 * ExecutiveSummaryBanner — תקציר מנהלים לחתם.
 * פסקה קצרה בראש הדוח שמסבירה במילים פשוטות את אסטרטגיית החיתום
 * שהמנוע בנה לתיק (איחוד/מחזור + הקלה חודשית), כדי לעזור לחתם לאשר.
 */
export default function ExecutiveSummaryBanner({ kpi }) {
  const sol = kpi?.proactive_solution;
  const pti = kpi?.pti_unified;

  // ללא פתרון פרואקטיבי (תיק רכישה טהור) — אין תקציר אסטרטגי
  if (!sol || !sol.relief_is_positive) return null;

  const ptiTxt = pti != null
    ? `הלקוח נמצא ב-PTI של ${pti.toFixed(1)}%. `
    : '';

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#C5A059]/40 bg-gradient-to-br from-[#1a1407] via-[#12100a] to-[#0d1524] p-6"
      style={{ boxShadow: '0 0 40px rgba(197,160,89,0.12)' }}
    >
      {/* shimmer line */}
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#C5A059]/60 to-transparent" />

      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-[#C5A059]/15 border border-[#C5A059]/40 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[#D4AF37] font-bold text-sm tracking-wider">אסטרטגיית חיתום — תקציר מנהלים</h3>
            <span className="text-[10px] text-[#C5A059]/60 border border-[#C5A059]/25 px-1.5 py-0.5 rounded">AI SOLVER</span>
          </div>

          <p className="text-white text-sm leading-relaxed">
            {ptiTxt}
            בוצע מחזור/איחוד אוטומטי
            {sol.term_is_auto ? ` לפריסה של ${sol.engine_term_years} שנה בריבית שמרנית ${sol.engine_rate}%` : ''}
            {' '}שמוריד את ההחזר החודשי מ-
            <span className="text-white font-bold">{fmt(sol.current_monthly)}</span>
            {' '}ל-
            <span className="text-emerald-300 font-bold">{fmt(sol.proposed_monthly)}</span>
            {' '}ומאזן את התיק.
            {sol.extinguished_count > 0 ? ` ${sol.extinguished_count} התחייבויות קיימות נסגרות במסגרת העסקה.` : ''}
          </p>

          {/* Relief strip */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-[#0d1524]/60 border border-[#1e2d4a] rounded-lg px-3 py-2">
              <span className="text-[#8892B0] text-xs">החזר נוכחי</span>
              <span className="text-white text-sm font-mono">{fmt(sol.current_monthly)}</span>
            </div>
            <ArrowLeft className="w-4 h-4 text-[#C5A059]/60" />
            <div className="flex items-center gap-2 bg-[#0d1524]/60 border border-[#1e2d4a] rounded-lg px-3 py-2">
              <span className="text-[#8892B0] text-xs">החזר משוער</span>
              <span className="text-emerald-300 text-sm font-mono">{fmt(sol.proposed_monthly)}</span>
            </div>
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
              <TrendingDown className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-300 text-xs font-bold">הקלה חודשית</span>
              <span className="text-emerald-200 text-sm font-bold font-mono">{fmt(sol.monthly_relief)}</span>
            </div>
          </div>

          {sol.condition_note && (
            <p className="text-[#4a5568] text-[11px] mt-3 leading-relaxed">{sol.condition_note} התיק מותנה בביטחונות.</p>
          )}
        </div>
      </div>
    </div>
  );
}