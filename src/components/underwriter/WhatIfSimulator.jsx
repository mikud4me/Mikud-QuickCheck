import React, { useState, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Sliders, Play, RotateCcw, TrendingUp, TrendingDown, Loader2, X, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// MIGRATION NOTE (Base44 → Supabase): base44.integrations.Core.InvokeLLM →
// the new whatIfNarrative Edge Function proxy (a Gemini/OpenAI key can't be
// exposed client-side, so a direct-from-frontend LLM call needed a thin
// server-side wrapper — see supabase/functions/whatIfNarrative).

/**
 * WhatIfSimulator — סימולטור "מה אם...?"
 * Lets the underwriter tweak loan/income params and instantly
 * see the impact on PTI, LTV, and the overall risk score.
 */
export default function WhatIfSimulator({ scoreObject, caseData }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const kpi = scoreObject?.kpi || {};
  const origIncome = kpi.verified_monthly_income || 0;
  const origLoanBalance = caseData?.existing_mortgage?.remaining_balance || 0;
  const origPropertyValue = caseData?.property?.value || origLoanBalance * 1.3 || 1000000;

  const [params, setParams] = useState({
    loanAmount: origLoanBalance || 1000000,
    monthlyPayment: kpi.current_mortgage_payment || 5000,
    monthlyIncome: origIncome || 20000,
    propertyValue: origPropertyValue,
    interestRate: 4.5,
  });

  const origPTI = kpi.pti_ratio || 0;
  const origLTV = kpi.ltv_ratio || 0;
  const origScore = kpi.risk_score || 0;

  const calcPTI = (p) => p.monthlyIncome > 0 ? ((p.monthlyPayment / p.monthlyIncome) * 100) : 99;
  const calcLTV = (p) => p.propertyValue > 0 ? ((p.loanAmount / p.propertyValue) * 100) : 99;

  const simPTI = calcPTI(params);
  const simLTV = calcLTV(params);

  // Rough score delta based on PTI and LTV changes
  const estimateScoreDelta = () => {
    let delta = 0;
    const ptiDiff = origPTI - simPTI;
    const ltvDiff = origLTV - simLTV;
    delta += ptiDiff * 0.6;  // PTI drives ~60% of financial pillar
    delta += ltvDiff * 0.3;  // LTV drives ~30% of collateral pillar
    const incomeDiff = ((params.monthlyIncome - origIncome) / (origIncome || 1)) * 15;
    delta += incomeDiff;
    return Math.round(delta);
  };

  const scoreDelta = estimateScoreDelta();
  const simScore = Math.max(0, Math.min(100, origScore + scoreDelta));

  const ptiColor = simPTI <= 35 ? '#22c55e' : simPTI <= 40 ? '#f59e0b' : '#ef4444';
  const ltvColor = simLTV <= 60 ? '#22c55e' : simLTV <= 75 ? '#f59e0b' : '#ef4444';
  const scoreColor = simScore >= 70 ? '#22c55e' : simScore >= 50 ? '#f59e0b' : '#ef4444';

  const runAIAnalysis = async () => {
    setLoading(true);
    setResult(null);
    try {
      const prompt = `
חתם משכנתאות ישראלי מנתח תרחיש "מה אם?" בתיק. 
מקור: PTI=${origPTI.toFixed(1)}%, LTV=${origLTV.toFixed(1)}%, ציון=${origScore}
תרחיש: PTI=${simPTI.toFixed(1)}%, LTV=${simLTV.toFixed(1)}%, ציון משוער=${simScore}

שינויים שנעשו:
- סכום הלוואה: ₪${origLoanBalance.toLocaleString('he-IL')} → ₪${params.loanAmount.toLocaleString('he-IL')}
- החזר חודשי: ₪${(kpi.current_mortgage_payment||0).toLocaleString('he-IL')} → ₪${params.monthlyPayment.toLocaleString('he-IL')}
- הכנסה חודשית: ₪${origIncome.toLocaleString('he-IL')} → ₪${params.monthlyIncome.toLocaleString('he-IL')}
- שווי נכס: ₪${origPropertyValue.toLocaleString('he-IL')} → ₪${params.propertyValue.toLocaleString('he-IL')}

ספק ב-2-3 משפטים בעברית: האם התרחיש הזה מספיק לאישור? מה עדיין חסר? מה ההמלצה שלך?
      `.trim();
      const { data, error } = await supabase.functions.invoke('whatIfNarrative', { body: { prompt } });
      if (error) throw error;
      setResult(data?.text);
    } catch {
      setResult('לא ניתן לייצר ניתוח AI כרגע.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setParams({
      loanAmount: origLoanBalance || 1000000,
      monthlyPayment: kpi.current_mortgage_payment || 5000,
      monthlyIncome: origIncome || 20000,
      propertyValue: origPropertyValue,
      interestRate: 4.5,
    });
    setResult(null);
  };

  const SliderField = ({ label, field, min, max, step, format }) => (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[#8892B0] text-xs">{label}</label>
        <span className="text-[#C5A059] text-xs font-mono font-bold">{format(params[field])}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={params[field]}
        onChange={e => setParams(p => ({ ...p, [field]: Number(e.target.value) }))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: '#C5A059' }}
      />
      <div className="flex justify-between text-[10px] text-[#2a3a55] mt-0.5">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );

  const DeltaBadge = ({ orig, sim, suffix = '', inverted = false }) => {
    const diff = sim - orig;
    const pct = orig > 0 ? ((diff / orig) * 100).toFixed(1) : '0';
    const isGood = inverted ? diff < 0 : diff > 0;
    if (Math.abs(diff) < 0.1) return <span className="text-[#4a5568] text-xs">ללא שינוי</span>;
    return (
      <span className={`text-xs font-bold ${isGood ? 'text-emerald-400' : 'text-red-400'}`}>
        {diff > 0 ? '+' : ''}{suffix === '₪' ? diff.toLocaleString('he-IL') : diff.toFixed(1)}{suffix !== '₪' ? suffix : ''} ({pct}%)
      </span>
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 border border-[#C5A059]/40 text-[#C5A059] rounded-xl hover:bg-[#C5A059]/10 transition-all text-sm font-semibold"
      >
        <Sliders className="w-4 h-4" />
        סימולטור מה-אם
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />

            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              <div
                className="bg-[#060b14] border border-[#C5A059]/30 rounded-2xl w-full max-w-3xl shadow-2xl shadow-black/70 max-h-[90vh] overflow-y-auto"
                dir="rtl"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="sticky top-0 bg-[#060b14] border-b border-[#1e2d4a] px-6 py-4 flex items-center justify-between z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#C5A059]/15 border border-[#C5A059]/30 flex items-center justify-center">
                      <Sliders className="w-4 h-4 text-[#C5A059]" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm">סימולטור "מה אם...?" — What-If Simulator</p>
                      <p className="text-[#8892B0] text-xs">שחק עם הפרמטרים וראה את ההשפעה על הציון בזמן אמת</p>
                    </div>
                  </div>
                  <button onClick={() => setOpen(false)} className="text-[#4a5568] hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left: Sliders */}
                  <div className="space-y-5">
                    <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-1">שנה פרמטרים</p>

                    <SliderField
                      label="סכום ההלוואה (₪)"
                      field="loanAmount"
                      min={200000} max={5000000} step={50000}
                      format={v => `₪${(v/1000).toFixed(0)}K`}
                    />
                    <SliderField
                      label="החזר חודשי (₪)"
                      field="monthlyPayment"
                      min={1000} max={25000} step={200}
                      format={v => `₪${v.toLocaleString('he-IL')}`}
                    />
                    <SliderField
                      label="הכנסה חודשית נטו (₪)"
                      field="monthlyIncome"
                      min={5000} max={80000} step={500}
                      format={v => `₪${v.toLocaleString('he-IL')}`}
                    />
                    <SliderField
                      label="שווי הנכס (₪)"
                      field="propertyValue"
                      min={500000} max={10000000} step={50000}
                      format={v => `₪${(v/1000).toFixed(0)}K`}
                    />
                    <SliderField
                      label="ריבית משוערת (%)"
                      field="interestRate"
                      min={2} max={9} step={0.1}
                      format={v => `${v.toFixed(1)}%`}
                    />

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={runAIAnalysis}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-50 text-[#0A0F1A] font-bold text-sm rounded-xl transition-all"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        {loading ? 'מנתח...' : 'נתח עם AI'}
                      </button>
                      <button
                        onClick={reset}
                        className="px-4 py-3 border border-[#1e2d4a] text-[#8892B0] hover:text-white hover:border-[#C5A059]/30 rounded-xl transition-all"
                        title="אפס לערכים מקוריים"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Right: Live results */}
                  <div className="space-y-4">
                    <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-1">תוצאות בזמן אמת</p>

                    {/* Score comparison */}
                    <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-2xl p-5">
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div className="text-center">
                          <p className="text-[#8892B0] text-xs mb-1">ציון מקורי</p>
                          <p className="text-2xl font-black font-mono text-white">{origScore}</p>
                        </div>
                        <div className="flex items-center justify-center">
                          <ChevronLeft className="w-6 h-6 text-[#C5A059]" />
                        </div>
                        <div className="text-center">
                          <p className="text-[#8892B0] text-xs mb-1">ציון משוער</p>
                          <p className="text-2xl font-black font-mono" style={{ color: scoreColor }}>{simScore}</p>
                        </div>
                      </div>
                      <div className="text-center">
                        <DeltaBadge orig={origScore} sim={simScore} />
                      </div>
                      {/* Mini score bar */}
                      <div className="mt-3 h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: scoreColor }}
                          animate={{ width: `${simScore}%` }}
                          transition={{ duration: 0.4 }}
                        />
                      </div>
                    </div>

                    {/* KPI metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* PTI */}
                      <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4">
                        <p className="text-[#8892B0] text-xs mb-2">יחס PTI</p>
                        <div className="flex items-end gap-2">
                          <p className="text-xl font-black font-mono" style={{ color: ptiColor }}>
                            {simPTI.toFixed(1)}%
                          </p>
                          <span className="text-[#4a5568] text-xs mb-0.5">/ תקרה 40%</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-[#1e2d4a] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: ptiColor }}
                            animate={{ width: `${Math.min(simPTI / 60 * 100, 100)}%` }}
                            transition={{ duration: 0.4 }}
                          />
                        </div>
                        <div className="mt-1">
                          <DeltaBadge orig={origPTI} sim={simPTI} suffix="%" inverted />
                        </div>
                        {simPTI <= 40 && origPTI > 40 && (
                          <p className="text-emerald-400 text-xs mt-1.5">✓ נכנס לטווח הירוק!</p>
                        )}
                        {simPTI > 40 && (
                          <p className="text-red-400 text-xs mt-1.5">⚠ עדיין מעל תקרה</p>
                        )}
                      </div>

                      {/* LTV */}
                      <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4">
                        <p className="text-[#8892B0] text-xs mb-2">יחס LTV</p>
                        <div className="flex items-end gap-2">
                          <p className="text-xl font-black font-mono" style={{ color: ltvColor }}>
                            {simLTV.toFixed(1)}%
                          </p>
                          <span className="text-[#4a5568] text-xs mb-0.5">/ תקרה 75%</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-[#1e2d4a] rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: ltvColor }}
                            animate={{ width: `${Math.min(simLTV / 100 * 100, 100)}%` }}
                            transition={{ duration: 0.4 }}
                          />
                        </div>
                        <div className="mt-1">
                          <DeltaBadge orig={origLTV} sim={simLTV} suffix="%" inverted />
                        </div>
                        {simLTV <= 60 && origLTV > 60 && (
                          <p className="text-emerald-400 text-xs mt-1.5">✓ נכנס לטווח הירוק!</p>
                        )}
                      </div>
                    </div>

                    {/* Monthly surplus */}
                    <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4">
                      <div className="flex justify-between items-center">
                        <p className="text-[#8892B0] text-xs">עודף חודשי אחרי החזר</p>
                        <p className="font-mono font-bold text-sm" style={{ color: (params.monthlyIncome - params.monthlyPayment) > 0 ? '#22c55e' : '#ef4444' }}>
                          ₪{(params.monthlyIncome - params.monthlyPayment).toLocaleString('he-IL')}
                        </p>
                      </div>
                    </div>

                    {/* AI Analysis */}
                    {result && (
                      <div className="bg-[#080d16] border border-[#C5A059]/20 rounded-xl p-4">
                        <p className="text-[#C5A059] text-xs font-semibold mb-2">ניתוח AI — המלצת חתם</p>
                        <p className="text-white/85 text-sm leading-relaxed">{result}</p>
                      </div>
                    )}
                    {loading && (
                      <div className="flex items-center gap-3 py-4 justify-center text-[#8892B0]">
                        <Loader2 className="w-4 h-4 animate-spin text-[#C5A059]" />
                        <span className="text-sm">מנוע AI מעריך את התרחיש...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}