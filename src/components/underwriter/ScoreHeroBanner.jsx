import React from 'react';
import { motion } from 'framer-motion';

const RATING_THEME = {
  'A+': { glow: 'rgba(34,197,94,0.12)', border: 'border-emerald-500/25', color: '#22c55e', label: 'Fast Track — אישור מיידי', pulse: 'bg-emerald-400', statusBg: 'bg-emerald-500/10' },
  'A':  { glow: 'rgba(34,197,94,0.08)', border: 'border-emerald-500/20', color: '#4ade80', label: 'אישור בכפוף לתנאים קלים', pulse: 'bg-emerald-400', statusBg: 'bg-emerald-500/10' },
  'B+': { glow: 'rgba(245,158,11,0.10)', border: 'border-amber-500/25', color: '#f59e0b', label: 'Standard Review', pulse: 'bg-amber-400', statusBg: 'bg-amber-500/10' },
  'B':  { glow: 'rgba(245,158,11,0.08)', border: 'border-amber-500/20', color: '#f59e0b', label: 'בדיקת מומחה נדרשת', pulse: 'bg-amber-400', statusBg: 'bg-amber-500/10' },
  'C':  { glow: 'rgba(249,115,22,0.10)', border: 'border-orange-500/25', color: '#f97316', label: 'Conditional — אישור מותנה', pulse: 'bg-orange-400', statusBg: 'bg-orange-500/10' },
  'D':  { glow: 'rgba(239,68,68,0.12)', border: 'border-red-500/25', color: '#ef4444', label: 'Decline / Escalate', pulse: 'bg-red-400', statusBg: 'bg-red-500/10' },
};

const pillarEntries = [
  { key: 'financial',  he: 'כושר החזר' },
  { key: 'collateral', he: 'בטחונות' },
  { key: 'stability',  he: 'יציבות' },
  { key: 'conduct',    he: 'התנהלות' },
];

function pillarColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function ScoreHeroBanner({ scoreObject, caseData }) {
  const { kpi } = scoreObject;
  const theme = RATING_THEME[kpi.rating] || RATING_THEME['D'];
  const pillars = scoreObject.riskAnalysis?.pillars || {};
  const alertCount = scoreObject.executiveAlerts?.alert_summary;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`relative rounded-2xl overflow-hidden border ${theme.border} bg-[#080e1a]`}
    >
      {/* Subtle top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#C5A059]/40 to-transparent" />

      <div className="relative z-10 px-8 py-8">

        {/* TOP ROW — Rating + Score + Case Info */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6 mb-8">

          {/* Rating block */}
          <div className="flex items-center gap-6 shrink-0">
            {/* Large rating letter */}
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: `${theme.color}10`, border: `1px solid ${theme.color}30` }}
            >
              <span
                className="text-5xl font-black font-mono"
                style={{ color: theme.color }}
              >
                {kpi.rating}
              </span>
            </div>
            <div>
              <p className="text-[#4a5568] text-xs uppercase tracking-[0.25em] mb-1">דירוג חיתומי</p>
              <p className="text-white font-bold text-lg leading-tight">{theme.label}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${theme.pulse}`} />
                <span className="text-xs text-[#8892B0]">ניתוח הושלם</span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px h-16 bg-[#1e2d4a]" />

          {/* Score + Confidence */}
          <div className="flex items-center gap-8">
            <div>
              <p className="text-[#4a5568] text-xs uppercase tracking-widest mb-1">ציון סיכון</p>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black font-mono" style={{ color: theme.color }}>{kpi.risk_score}</span>
                <span className="text-[#4a5568] text-sm">/100</span>
              </div>
            </div>
            <div>
              <p className="text-[#4a5568] text-xs uppercase tracking-widest mb-1">רמת ביטחון</p>
              <span className={`text-3xl font-black font-mono ${kpi.confidence_level >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {kpi.confidence_level}%
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px h-16 bg-[#1e2d4a]" />

          {/* Alert summary chips */}
          {alertCount && (
            <div className="flex items-center gap-3 flex-wrap">
              {(alertCount.critical_count + alertCount.high_count) > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/8 border border-red-500/25 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-400 text-xs font-semibold">{alertCount.critical_count + alertCount.high_count} ממצאים קריטיים</span>
                </div>
              )}
              {alertCount.mitigant_count > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/8 border border-emerald-500/25 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-400 text-xs font-semibold">{alertCount.mitigant_count} גורמים מפצים</span>
                </div>
              )}
            </div>
          )}

          {/* Case info — pushed right */}
          {caseData && (
            <div className="lg:mr-auto shrink-0 text-right">
              <p className="text-[#4a5568] text-xs uppercase tracking-widest">מספר תיק</p>
              <p className="text-[#C5A059] font-mono text-base font-bold mt-0.5">{caseData.case_number || '—'}</p>
              {caseData.primary_borrower?.full_name && (
                <p className="text-[#8892B0] text-xs mt-0.5">{caseData.primary_borrower.full_name}</p>
              )}
            </div>
          )}
        </div>

        {/* BOTTOM ROW — Pillar cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {pillarEntries.map(({ key, he }) => {
            const p = pillars[key];
            if (!p) return null;
            const pColor = pillarColor(p.score);
            const pLabel = p.score >= 80 ? 'מצוין' : p.score >= 60 ? 'סביר' : p.score >= 40 ? 'חלש' : 'קריטי';
            return (
              <div key={key} className="bg-[#060c18] border border-[#1a2640] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[#8892B0] text-xs font-medium">{he}</p>
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: pColor, background: `${pColor}12` }}>
                    {pLabel}
                  </span>
                </div>
                <div className="h-1 bg-[#1a2640] rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${p.score}%`, backgroundColor: pColor }}
                  />
                </div>
                <p className="text-xl font-black font-mono" style={{ color: pColor }}>{p.score}</p>
              </div>
            );
          })}
        </div>

      </div>
    </motion.div>
  );
}