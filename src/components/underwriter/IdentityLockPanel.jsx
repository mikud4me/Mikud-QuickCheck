import React from 'react';
import { EvidenceButton } from './EvidenceViewer';

const STATUS_CONFIG = {
  green: { label: 'אומת', color: '#22c55e', bg: 'bg-green-500/10 border-green-500/30' },
  yellow: { label: 'חלקי', color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/30' },
  red: { label: 'כשל', color: '#ef4444', bg: 'bg-red-500/10 border-red-500/30' }
};

const SOURCE_STATUS = {
  verified: { label: 'אומת', color: 'text-green-400' },
  missing: { label: 'חסר', color: 'text-amber-400' },
  mismatch: { label: 'אי-התאמה', color: 'text-red-400' }
};

function BorrowerLock({ borrower, label }) {
  const cfg = STATUS_CONFIG[borrower.lock_status] || STATUS_CONFIG.yellow;

  return (
    <div className={`rounded-xl border p-4 ${cfg.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[#8892B0] text-xs">{label}</p>
          <p className="text-white font-semibold">{borrower.borrower_name}</p>
          {borrower.id_number && (
            <p className="text-[#8892B0] text-xs font-mono">{borrower.id_number}</p>
          )}
        </div>
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border"
            style={{ borderColor: `${cfg.color}50`, background: `${cfg.color}12`, color: cfg.color }}
          >
            <span className="text-sm font-black">
              {borrower.lock_status === 'green' ? 'V' : borrower.lock_status === 'red' ? 'X' : '~'}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: cfg.color }}>{cfg.label}</p>
        </div>
      </div>

      {/* ID expiry alert */}
      {borrower.id_expired && (
        <div className="mb-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
          תעודת זהות פגת תוקף — {borrower.id_expiry}
        </div>
      )}

      {/* Sources */}
      <div className="space-y-1.5">
        {(borrower.sources || []).map((src, i) => {
          const ss = SOURCE_STATUS[src.status] || SOURCE_STATUS.missing;
          const isFuzzy = src.source === 'תלוש שכר' && src.fuzzy_match === true;
          const wasNormalized = src.source === 'תלוש שכר' && src.status === 'verified' && src.id_match === true;
          return (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-[#8892B0]">{src.source}</span>
              <div className="flex items-center gap-2">
                {src.file_url && (
                  <EvidenceButton
                    fileUrl={src.file_url}
                    page={src.source_page || null}
                    label={src.source}
                    size="sm"
                  />
                )}
                <span className={`${ss.color} font-medium flex items-center gap-1`}>
                  {ss.label}
                  {(wasNormalized || isFuzzy) && (
                    <span className="text-emerald-400/60 text-[10px]">†</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Footnote — fuzzy or OCR normalization note */}
      {(() => {
        const payslipSrc = (borrower.sources || []).find(s => s.source === 'תלוש שכר');
        if (!payslipSrc || payslipSrc.status !== 'verified' || !payslipSrc.id_match) return null;
        const note = payslipSrc.fuzzy_note || (payslipSrc.fuzzy_match ? 'אומת ברמת ביטחון גבוהה (שונות OCR)' : 'אומת לאחר נורמליזציה של אפס מוביל');
        return <p className="text-[#4a5568] text-[10px] mt-2">† {note}</p>;
      })()}
    </div>
  );
}

export default function IdentityLockPanel({ identityVerification }) {
  const overall = STATUS_CONFIG[identityVerification.overall_status] || STATUS_CONFIG.yellow;

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/18 rounded-2xl p-6 shadow-xl shadow-black/40">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[#8892B0] text-xs uppercase tracking-widest">אימות זהות משולש</p>
          <p className="text-white font-semibold mt-0.5">נעילת זהות משולשת</p>
        </div>
        <div
          className={`px-3 py-1.5 rounded-xl border text-sm font-semibold ${overall.bg}`}
          style={{ color: overall.color }}
        >
          {overall.label}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs text-[#8892B0]">
        <span>ת.ז</span>
        <span>·</span>
        <span>תלוש שכר</span>
        <span>·</span>
        <span>עו"ש</span>
      </div>

      {/* Borrowers */}
      <div className="space-y-3">
        <BorrowerLock borrower={identityVerification.borrower1} label="לווה ראשי" />
        {identityVerification.borrower2 && (
          <BorrowerLock borrower={identityVerification.borrower2} label="לווה שני" />
        )}
      </div>

      {/* Overall warning */}
      {identityVerification.overall_status !== 'green' && (
        <div className="mt-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <p className="text-amber-400 text-xs">
            {identityVerification.overall_status === 'red'
              ? 'אי-התאמת זהות זוהתה — נדרש אימות ידני דחוף'
              : 'נתוני זהות חלקיים — יש להשלים מסמכים חסרים'}
          </p>
        </div>
      )}
    </div>
  );
}