import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, Shield, Briefcase, CreditCard } from 'lucide-react';
import { EvidenceButton } from './EvidenceViewer';

const PILLAR_CONFIG = {
  financial: { he: 'כושר החזר', en: 'Financial Capacity', icon: TrendingUp, desc: 'PTI, הכנסה מאומתת, יכולת פירעון' },
  collateral: { he: 'בטחונות', en: 'Collateral / LTV', icon: Shield, desc: 'LTV, שווי נכס, הון עצמי' },
  stability: { he: 'יציבות תעסוקתית', en: 'Employment Stability', icon: Briefcase, desc: 'ותק, סוג העסקה, יציבות' },
  conduct: { he: 'התנהלות פיננסית', en: 'Financial Conduct', icon: CreditCard, desc: 'BDI, עו"ש, דגלים אדומים' },
};

const FLAG_STYLES = {
  positive: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warning:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
  neutral:  'text-[#8892B0] bg-[#1e2d4a]/50 border-[#1e2d4a]',
};

function scoreColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score >= 80) return { text: 'מצוין', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  if (score >= 60) return { text: 'סביר', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
  if (score >= 40) return { text: 'חלש', cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' };
  return { text: 'קריטי', cls: 'text-red-400 bg-red-500/10 border-red-500/30' };
}

function PillarRow({ name, pillar, expanded, onToggle }) {
  const cfg = PILLAR_CONFIG[name];
  const score = pillar.score;
  const weight = Math.round(pillar.weight * 100);
  const color = scoreColor(score);
  const label = scoreLabel(score);
  const Icon = cfg.icon;

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${expanded ? 'border-[#C5A059]/30' : 'border-[#1e2d4a]'}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#0d1524]/80 transition-colors text-right"
      >
        {/* Icon */}
        <div className="w-8 h-8 rounded-lg bg-[#1e2d4a] flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#C5A059]" />
        </div>

        {/* Name + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-white font-semibold text-sm">{cfg.he}</span>
            <span className="text-[#4a5568] text-xs hidden sm:inline">{cfg.en}</span>
            <span className="text-xs border px-1.5 py-0.5 rounded text-[#C5A059] border-[#C5A059]/30">
              {weight}%
            </span>
            <span className={`text-xs border px-1.5 py-0.5 rounded font-semibold ${label.cls}`}>
              {label.text}
            </span>
          </div>
          <div className="h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${score}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}50` }}
            />
          </div>
        </div>

        {/* Score */}
        <div className="text-center shrink-0 w-16">
          <span className="text-2xl font-black font-mono" style={{ color }}>{score}</span>
          <span className="text-[#4a5568] text-xs">/100</span>
        </div>

        {/* Weighted */}
        <div className="text-center shrink-0 w-14 hidden sm:block">
          <p className="text-[#C5A059] text-sm font-mono font-bold">{pillar.weighted.toFixed(0)}</p>
          <p className="text-[#4a5568] text-xs">משוקלל</p>
        </div>

        {/* Expand icon */}
        <div className="shrink-0 text-[#4a5568]">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Evidence detail */}
      {expanded && (
        <div className="border-t border-[#1e2d4a] bg-[#080d16]">
          <div className="px-5 py-3 mb-1">
            <p className="text-[#4a5568] text-xs">{cfg.desc}</p>
            {pillar.pillar_insight && (
              <p className="text-[#C5A059]/80 text-xs mt-1.5 font-medium italic border-r-2 border-[#C5A059]/30 pr-2">
                {pillar.pillar_insight}
              </p>
            )}
          </div>
          {pillar.evidence?.length > 0 ? (
            <div className="px-5 pb-4 space-y-2">
              {pillar.evidence.map((ev, i) => (
                <div key={i} className={`flex items-center justify-between py-2 px-3 rounded-lg border ${FLAG_STYLES[ev.flag] || FLAG_STYLES.neutral}`}>
                  <span className="text-sm text-[#c8d4e0]">{ev.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono">{ev.value}</span>
                    <EvidenceButton
                      fileUrl={ev.source_file_url || null}
                      page={ev.source_page}
                      label={ev.label}
                      size="sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#4a5568] text-xs px-5 pb-4">אין נתונים</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PillarBreakdown({ riskAnalysis }) {
  const [expanded, setExpanded] = useState({});
  const pillars = riskAnalysis.pillars;
  const totalWeighted = Object.values(pillars).reduce((s, p) => s + p.weighted, 0);

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/18 rounded-2xl p-6 shadow-xl shadow-black/40">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[#8892B0] text-xs uppercase tracking-widest">פירוט עמודי הניקוד</p>
          <p className="text-white font-bold mt-0.5">ניתוח סיכונים מפורט</p>
        </div>
        <div className="text-center bg-black/30 border border-[#C5A059]/20 rounded-xl px-4 py-2">
          <p className="text-[#8892B0] text-xs">ציון גולמי</p>
          <p className="text-[#C5A059] font-black font-mono text-lg">{totalWeighted.toFixed(1)}</p>
        </div>
      </div>

      <div className="space-y-2">
        {Object.entries(pillars).map(([name, pillar]) => (
          <PillarRow
            key={name}
            name={name}
            pillar={pillar}
            expanded={!!expanded[name]}
            onToggle={() => setExpanded(prev => ({ ...prev, [name]: !prev[name] }))}
          />
        ))}
      </div>

      {/* Bonuses & Penalties summary */}
      {(riskAnalysis.bonus_list?.length > 0 || riskAnalysis.penalty_list?.length > 0) && (
        <div className="mt-5 pt-4 border-t border-[#1e2d4a]">
          <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-3">תוספות וניכויים</p>
          <div className="space-y-2">
            {riskAnalysis.bonus_list?.map((b, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                <span className="text-emerald-400/80 text-sm">{b.label}</span>
                <div className="flex items-center gap-2">
                  {b.value && <span className="text-xs text-[#8892B0]">{b.value}</span>}
                  <span className="text-emerald-400 font-bold font-mono">+{b.points}</span>
                </div>
              </div>
            ))}
            {riskAnalysis.penalty_list?.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                <div>
                  <span className="text-red-400/80 text-sm">{p.label}</span>
                  {p.detail && <p className="text-xs text-[#4a5568] mt-0.5">{p.detail}</p>}
                </div>
                <span className="text-red-400 font-bold font-mono shrink-0">{p.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}