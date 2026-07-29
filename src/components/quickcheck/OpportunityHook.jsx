import React from 'react';
import { TrendingDown, Zap, ArrowLeft } from 'lucide-react';

/**
 * OpportunityHook — "בועת החיסכון המהירה"
 * מציג אומדן חיסכון חודשי בולט בראש הדוח המהיר.
 */
export default function OpportunityHook({ opportunityData }) {
    if (!opportunityData) return null;

    const {
        current_monthly_total = 0,
        estimated_new_payment = 0,
        monthly_savings = 0,
        pti_before = 0,
        pti_after = 0,
        is_relevant,
        label
    } = opportunityData;

    // הגנה: אם השדות המספריים חסרים/null — אל תרנדר (מונע קריסת toLocaleString על null)
    const cur = Number(current_monthly_total) || 0;
    const est = Number(estimated_new_payment) || 0;
    const savings = Number(monthly_savings) || 0;
    const ptiBefore = Number(pti_before) || 0;
    const ptiAfter = Number(pti_after) || 0;

    if (!is_relevant || savings <= 0) return null;

    const savingsPct = cur > 0
        ? Math.round((savings / cur) * 100)
        : 0;

    const ptiImprovement = ptiBefore > 0 && ptiAfter > 0
        ? (ptiBefore - ptiAfter).toFixed(1)
        : null;

    return (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-l from-emerald-950/80 to-slate-900/90 p-5 mb-2">
            {/* Glow */}
            <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl pointer-events-none" />

            {/* Badge */}
            <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-full px-3 py-1">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-300 text-xs font-black tracking-widest uppercase">Opportunity Hook</span>
                </div>
                <span className="text-slate-400 text-xs">{label || 'פוטנציאל מיחזור / איחוד חובות'}</span>
            </div>

            {/* Main numbers row */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* Current */}
                <div className="flex-1 min-w-[120px] bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
                    <p className="text-slate-400 text-xs mb-1">החזר נוכחי</p>
                    <p className="text-white text-xl font-black font-mono">₪{cur.toLocaleString()}</p>
                    {ptiBefore > 0 && (
                        <p className="text-xs mt-1 font-bold" style={{ color: ptiBefore > 40 ? '#ef4444' : ptiBefore > 35 ? '#f59e0b' : '#22c55e' }}>
                            PTI {ptiBefore.toFixed(1)}%
                        </p>
                    )}
                </div>

                {/* Arrow */}
                <ArrowLeft className="w-5 h-5 text-emerald-400 shrink-0" />

                {/* New */}
                <div className="flex-1 min-w-[120px] bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-3 text-center">
                    <p className="text-emerald-300 text-xs mb-1">החזר משוער (4% / 20 שנה)</p>
                    <p className="text-emerald-300 text-xl font-black font-mono">₪{est.toLocaleString()}</p>
                    {ptiAfter > 0 && (
                        <p className="text-xs mt-1 font-bold" style={{ color: ptiAfter > 40 ? '#ef4444' : ptiAfter > 35 ? '#f59e0b' : '#22c55e' }}>
                            PTI {ptiAfter.toFixed(1)}%
                        </p>
                    )}
                </div>

                {/* Savings */}
                <div className="flex-1 min-w-[120px] bg-gradient-to-b from-emerald-600/20 to-emerald-500/10 border-2 border-emerald-400/60 rounded-xl p-3 text-center shadow-lg shadow-emerald-900/30">
                    <p className="text-emerald-200 text-xs mb-1 font-bold">חיסכון חודשי משוער</p>
                    <p className="text-emerald-300 text-2xl font-black font-mono flex items-center justify-center gap-1">
                        <TrendingDown className="w-5 h-5" />
                        ₪{savings.toLocaleString()}
                    </p>
                    <p className="text-emerald-400 text-xs mt-1 font-bold">
                        {savingsPct > 0 && `${savingsPct}% פחות`}
                        {ptiImprovement && ` · PTI ↓${ptiImprovement}%`}
                    </p>
                </div>
            </div>

            {/* Annual savings */}
            <div className="mt-3 text-center">
                <span className="text-xs text-slate-400">
                    חיסכון שנתי משוער:{' '}
                    <span className="text-emerald-300 font-bold">₪{(savings * 12).toLocaleString()}</span>
                    {' '} | חיסכון ל-20 שנה:{' '}
                    <span className="text-emerald-300 font-bold">₪{(savings * 240).toLocaleString()}</span>
                </span>
            </div>

            <p className="text-xs text-slate-500 mt-2 text-center">
                * אומדן ראשוני בלבד · 4% ריבית שנתית · 20 שנה · אינו מחייב · לפי נתוני המסמכים שהועלו
            </p>
        </div>
    );
}