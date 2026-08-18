/**
 * ShadowDebtValidator — ממשק אישור חובות צל
 * מציג חובות צל שזוהו בדפי העו"ש ומאפשר ליועץ לאשר/לדחות כל אחד.
 * כשאושר חוב — מחשב מחדש את ה-PTI ומציג אזהרה אם עולה מ-40%.
 */
import React, { useState, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, TrendingUp, Info } from 'lucide-react';

export default function ShadowDebtValidator({ shadowDebts, totalNetIncome, proposedPayment, currentLoansTotal }) {
  const [decisions, setDecisions] = useState({}); // id -> 'confirmed' | 'denied' | null
  const [notes, setNotes] = useState({});

  const confirmedTotal = useMemo(() =>
    shadowDebts ? shadowDebts.reduce((sum, d, i) =>
      decisions[i] === 'confirmed' ? sum + (d.estimated_amount || 0) : sum, 0
    ) : 0
  , [decisions, shadowDebts]);

  if (!shadowDebts || shadowDebts.length === 0) return null;

  const toggle = (idx, val) => {
    setDecisions(prev => ({ ...prev, [idx]: prev[idx] === val ? null : val }));
  };



  const adjustedPTI = totalNetIncome > 0
    ? ((currentLoansTotal + proposedPayment + confirmedTotal) / totalNetIncome) * 100
    : null;

  const basePTI = totalNetIncome > 0
    ? ((currentLoansTotal + proposedPayment) / totalNetIncome) * 100
    : null;

  const ptiColor = adjustedPTI == null ? '#6b7280'
    : adjustedPTI < 30 ? '#16a34a'
    : adjustedPTI < 40 ? '#ca8a04'
    : '#dc2626';

  const confirmedCount = Object.values(decisions).filter(v => v === 'confirmed').length;
  const pendingCount = shadowDebts.length - Object.values(decisions).filter(Boolean).length;

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-amber-500/30 rounded-2xl overflow-hidden shadow-xl shadow-black/40" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-500/20 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1">
          <p className="text-white text-sm font-semibold">מנוע זיהוי חובות צל — Shadow Debt Detector</p>
          <p className="text-amber-300/70 text-xs">
            {shadowDebts.length} תשלומים חוזרים זוהו שאינם מוכרים כהוצאות מחיה
            {pendingCount > 0 && <span className="mr-2 text-amber-400 font-bold">· {pendingCount} ממתינים לאישור</span>}
          </p>
        </div>
        {confirmedCount > 0 && (
          <div className="text-center">
            <div className="text-xs text-[#8892B0]">PTI מעודכן</div>
            <div className="text-sm font-bold font-mono" style={{ color: ptiColor }}>
              {adjustedPTI?.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 px-5 py-2.5 bg-[#0a1020] border-b border-[#1e2d4a]">
        <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-sky-300/80 text-xs leading-relaxed">
          חוב שיאושר יתווסף אוטומטית לנוסחת ה-PTI. בעת דחייה — יש להזין הסבר לתיעוד.
        </p>
      </div>

      {/* Debt list */}
      <div className="divide-y divide-[#0d1524]">
        {shadowDebts.map((debt, i) => {
          const status = decisions[i];
          const rowBg = status === 'confirmed' ? 'bg-red-500/5'
            : status === 'denied' ? 'bg-emerald-500/5'
            : 'bg-transparent';

          return (
            <div key={i} className={`px-5 py-3 transition-colors ${rowBg}`}>
              <div className="flex items-center gap-3">
                {/* Amount badge */}
                <div className="w-20 text-center shrink-0">
                  <div className="text-white font-mono font-bold text-sm">
                    ₪{(debt.estimated_amount || 0).toLocaleString('he-IL')}
                  </div>
                  <div className="text-[#4a5568] text-xs">{debt.occurrences} חודשים</div>
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">{debt.finding}</p>
                  <p className="text-[#4a5568] text-xs">{debt.description || debt.action}</p>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle(i, 'confirmed')}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                      status === 'confirmed'
                        ? 'bg-red-500/20 border-red-500/50 text-red-300'
                        : 'border-[#2a3a55] text-[#6b7280] hover:border-red-500/40 hover:text-red-400'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    חוב
                  </button>
                  <button
                    onClick={() => toggle(i, 'denied')}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                      status === 'denied'
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'border-[#2a3a55] text-[#6b7280] hover:border-emerald-500/40 hover:text-emerald-400'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    הוצאה
                  </button>
                </div>
              </div>

              {/* Note field when denied */}
              {status === 'denied' && (
                <div className="mt-2 mr-[92px]">
                  <input
                    type="text"
                    placeholder="הסבר: עזרה להורים / ארנונה / אחר..."
                    value={notes[i] || ''}
                    onChange={e => setNotes(prev => ({ ...prev, [i]: e.target.value }))}
                    className="w-full bg-[#111827] border border-emerald-500/30 text-white text-xs rounded-lg px-3 py-1.5 outline-none placeholder:text-[#3a4a65] focus:border-emerald-500/60"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* PTI Impact footer */}
      {confirmedCount > 0 && (
        <div className="px-5 py-3 border-t border-amber-500/20 bg-amber-500/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>
              סה"כ חובות צל מאושרים: <strong className="text-white font-mono">₪{confirmedTotal.toLocaleString('he-IL')}</strong>/חודש
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {basePTI != null && (
              <span className="text-[#6b7280]">
                PTI בסיס: <span className="font-mono">{basePTI.toFixed(1)}%</span>
              </span>
            )}
            <span className="font-mono font-bold" style={{ color: ptiColor }}>
              → PTI מעודכן: {adjustedPTI?.toFixed(1)}%
            </span>
            {adjustedPTI > 40 && (
              <span className="text-red-400 font-bold text-xs border border-red-500/40 px-2 py-0.5 rounded">
                ⚠ חורג מ-40%
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}