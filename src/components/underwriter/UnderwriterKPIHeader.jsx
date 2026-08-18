import React from 'react';
import { TrendingUp, TrendingDown, User, Building2, Calendar, Briefcase, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { EvidenceButton } from './EvidenceViewer';

const FLAG_CONFIG = {
  positive: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', value: 'text-emerald-400', label: 'text-emerald-400/70' },
  warning: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', value: 'text-amber-400', label: 'text-amber-400/70' },
  critical: { border: 'border-red-500/30', bg: 'bg-red-500/5', value: 'text-red-400', label: 'text-red-400/70' },
  neutral: { border: 'border-[#1e2d4a]', bg: 'bg-[#0d1524]', value: 'text-white', label: 'text-[#8892B0]' },
};

function KPICard({ label, value, sublabel, flag, icon: Icon }) {
  const cfg = FLAG_CONFIG[flag] || FLAG_CONFIG.neutral;
  return (
    <div className={`rounded-xl border p-4 ${cfg.border} ${cfg.bg} flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-medium uppercase tracking-wider ${cfg.label}`}>{label}</p>
        {Icon && <Icon className={`w-3.5 h-3.5 ${cfg.value} opacity-60`} />}
      </div>
      <p className={`text-xl font-black font-mono leading-none ${cfg.value}`}>{value}</p>
      {sublabel && <p className={`text-xs ${cfg.label} leading-tight`}>{sublabel}</p>}
    </div>
  );
}

function BorrowerBadge({ borrower, label, index }) {
  const employmentIcons = {
    'שכיר': Briefcase,
    'שבתון': Calendar,
    'עצמאי': Building2,
    'פנסיונר': User,
  };
  const empType = borrower.employment_type || '';
  const EmpIcon = Object.entries(employmentIcons).find(([k]) => empType.includes(k))?.[1] || Briefcase;
  const isOnSabbatical = empType.includes('שבתון');
  const isSelfEmployed = empType.includes('עצמאי');

  return (
    <div className={`flex-1 min-w-0 rounded-xl border p-4 ${isOnSabbatical ? 'border-amber-500/30 bg-amber-500/5' : 'border-[#1a2640] bg-[#060c18]'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isOnSabbatical ? 'bg-amber-500/20' : 'bg-[#1e2d4a]'}`}>
          <User className={`w-4 h-4 ${isOnSabbatical ? 'text-amber-400' : 'text-[#C5A059]'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[#8892B0] text-xs">{label}</p>
            {isOnSabbatical && (
              <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">שבתון</span>
            )}
            {isSelfEmployed && (
              <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">עצמאי</span>
            )}
          </div>
          <p className="text-white font-bold text-sm leading-tight mt-0.5 truncate">{borrower.name || '—'}</p>
          {borrower.employer && (
            <p className="text-[#8892B0] text-xs mt-0.5 truncate">{borrower.employer}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {borrower.monthly_income > 0 && (
              <span className="text-emerald-400 text-xs font-mono font-semibold flex items-center gap-1">
                ₪{borrower.monthly_income.toLocaleString('he-IL')}
                <EvidenceButton
                  fileUrl={borrower.income_source_file_url || null}
                  page={borrower.income_source_page || null}
                  label={`הכנסה נטו — ${borrower.name || ''}`}
                  size="sm"
                />
              </span>
            )}
            {borrower.seniority_years > 0 && (
              <span className="text-[#8892B0] text-xs flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {borrower.seniority_years} שנות ותק
              </span>
            )}
            {borrower.payslips_count > 0 && (
              <span className="text-[#C5A059] text-xs">{borrower.payslips_count} תלושים</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UnderwriterKPIHeader({ kpi, borrowers, scoreObject }) {
  // ── PTI Sync Fix: בתיקי מחזור, pti_current = 0 כי המשכנתא לא נספרת ב-total_liabilities.
  // השתמש ב-pti_unified (שכולל את המשכנתא הקיימת) או ב-refinanceImpact.current_pti כ-fallback.
  const refinanceCurrentPTI = scoreObject?.refinanceImpact?.current_pti || null;
  const effectivePTICurrent = (kpi.pti_current > 0)
    ? kpi.pti_current
    : (refinanceCurrentPTI || kpi.pti_unified || 0);

  // סך החזרים נוכחי — כולל משכנתא קיימת
  const effectiveLiabilities = (kpi.total_liabilities > 0)
    ? kpi.total_liabilities
    : (scoreObject?.refinanceImpact?.current_total_monthly || 0);

  const ltvFlag = kpi.ltv === null ? 'neutral' : kpi.ltv < 45 ? 'positive' : kpi.ltv < 75 ? 'warning' : 'critical';
  const ptiFlag = effectivePTICurrent === 0 ? 'neutral' : effectivePTICurrent < 30 ? 'positive' : effectivePTICurrent <= 40 ? 'warning' : 'critical';
  const incomeFlag = kpi.verified_income > 0 ? (kpi.verified_income > 15000 ? 'positive' : 'warning') : 'critical';
  const availableFlag = kpi.available_for_mortgage > 5000 ? 'positive' : kpi.available_for_mortgage > 0 ? 'warning' : 'critical';

  const ptiLabel = kpi.pti_with_proposed
    ? `לאחר מיחזור: ${kpi.pti_with_proposed}%`
    : 'ללא הצעה ספציפית';

  return (
    <div className="bg-[#080e1a] border border-[#1a2640] rounded-2xl p-6 flex flex-col gap-6">

      {/* Borrower profiles */}
      <div>
        <p className="text-[#4a5568] text-xs uppercase tracking-[0.2em] mb-3">פרופיל לווים</p>
        <div className="flex gap-3 flex-col sm:flex-row">
          <BorrowerBadge borrower={borrowers.borrower1} label="לווה ראשי" index={0} />
          {borrowers.borrower2 && (
            <BorrowerBadge borrower={borrowers.borrower2} label="לווה שני" index={1} />
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-[#1a2640]" />

      {/* KPI Grid */}
      <div>
        <p className="text-[#4a5568] text-xs uppercase tracking-[0.2em] mb-3">מדדים פיננסיים מרכזיים</p>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <KPICard
            label="LTV"
            value={kpi.ltv !== null ? `${kpi.ltv}%` : '—'}
            sublabel={(() => {
              // אם יש LTV — חייב להיות נכס. חשב שווי נכס לאחור מ-LTV
              if (kpi.ltv && kpi.ltv > 0) {
                // נסה לחשב שווי נכס אם קיים
                const propVal = kpi.property_value;
                if (propVal && propVal > 0) return `נכס: ₪${Math.round(propVal / 1000).toLocaleString('he-IL')}K`;
                // חשב מ-LTV אם יש loan amount
                return `LTV ${kpi.ltv}% — נכס מחושב`;
              }
              return 'ללא נכס בתיק';
            })()}
            flag={ltvFlag}
            icon={Building2}
          />
          <KPICard
            label="PTI נוכחי"
            value={`${effectivePTICurrent}%`}
            sublabel={ptiLabel}
            flag={ptiFlag}
            icon={ptiFlag === 'positive' ? TrendingDown : TrendingUp}
          />
          <KPICard
            label="הכנסה מאומתת"
            value={kpi.verified_income > 0 ? `₪${kpi.verified_income.toLocaleString('he-IL')}` : '—'}
            sublabel={
              borrowers.borrower2
                ? `ב1: ₪${(kpi.income_b1 || 0).toLocaleString('he-IL')} | ב2: ₪${(kpi.income_b2 || 0).toLocaleString('he-IL')}`
                : 'לווה יחיד'
            }
            flag={incomeFlag}
            icon={CheckCircle2}
          />
          <KPICard
            label="כושר החזר פנוי"
            value={kpi.available_for_mortgage > 0 ? `₪${kpi.available_for_mortgage.toLocaleString('he-IL')}` : '—'}
            sublabel="לפי כלל 40%"
            flag={availableFlag}
            icon={availableFlag === 'positive' ? CheckCircle2 : AlertTriangle}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-[#1a2640]">
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <span className="text-[#4a5568]">רמת ביטחון:</span>
          <span className={`font-bold ${kpi.confidence_level >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {kpi.confidence_level}%
          </span>
          {kpi.requires_manual_review && (
            <span className="flex items-center gap-1.5 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded text-xs">
              <AlertTriangle className="w-3 h-3" />
              נדרשת בדיקה ידנית
            </span>
          )}
        </div>
        <div className="text-xs text-[#4a5568]">
          סך החזרים חודשיים נוכחי: <span className="text-[#8892B0] font-mono">₪{effectiveLiabilities.toLocaleString('he-IL')}</span>
        </div>
      </div>
    </div>
  );
}