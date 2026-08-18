import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { RotateCcw, FileText, RefreshCw } from 'lucide-react';
import WhatIfSimulator from './WhatIfSimulator';

// MIGRATION NOTE (Base44 → Supabase): base44.entities.MortgageCase.update →
// supabase.from('mortgage_cases').update(...).eq('id', caseId).
export default function ActionBar({ scoreObject, caseId, borrowers, onReload, onReset, onPrint }) {
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);


  const { rating, rating_label, risk_score, requires_manual_review } = scoreObject.kpi;

  const handleDecision = (type) => setDecision(type);


  const handleSave = async () => {
    if (!caseId || !decision) return;
    setSaving(true);
    try {
      const statusMap = { approve: 'approved', conditional: 'under_review', reject: 'rejected' };
      const { error } = await supabase.from('mortgage_cases').update({
        case_status: statusMap[decision],
        score_data: scoreObject,
        underwriter_decision: { type: decision, note, decided_at: new Date().toISOString() },
      }).eq('id', caseId);
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Error saving decision:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/18 rounded-2xl p-6 shadow-xl shadow-black/40">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[#8892B0] text-xs uppercase tracking-widest">מרכז קבלת החלטות</p>
          <p className="text-white font-semibold mt-0.5">Action Center</p>
        </div>
        <div className="text-right">
          <p className="text-[#8892B0] text-xs">ציון: {risk_score} | דירוג: {rating}</p>
          <p className="text-[#C5A059] text-xs">{rating_label}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Decision Buttons */}
        <div className="space-y-3">
          <p className="text-[#8892B0] text-xs mb-3">בחר החלטה:</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'approve', label: 'אישור עקרוני', active: 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-500/30', inactive: 'border-green-500/30 text-green-400 hover:bg-green-500/10' },
              { key: 'conditional', label: 'אישור מותנה', active: 'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-500/30', inactive: 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10' },
              { key: 'reject', label: 'דחייה מנומקת', active: 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/30', inactive: 'border-red-500/30 text-red-400 hover:bg-red-500/10' },
            ].map(btn => (
              <button key={btn.key} onClick={() => handleDecision(btn.key)}
                className={`py-3 px-4 rounded-xl border font-semibold text-sm transition-all ${decision === btn.key ? btn.active : btn.inactive}`}>
                {btn.label}
              </button>
            ))}
          </div>

          {decision && (
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder={decision === 'approve' ? 'הערות לאישור (אופציונלי)...' : decision === 'conditional' ? 'פרט תנאים לאישור...' : 'פרט נימוקי דחייה...'}
              className="w-full bg-[#080d16] border border-[#1e2d4a] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-[#C5A059]/40 placeholder:text-[#4a5568] resize-none h-20"
            />
          )}
        </div>

        {/* Summary & Actions */}
        <div className="space-y-3">
          <div className="border border-[#1e2d4a] rounded-xl p-4 bg-[#080d16]">
            <p className="text-[#8892B0] text-xs mb-3">סיכום לחתם</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#8892B0]">תיק</span>
                <span className="text-white">{borrowers.borrower1.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8892B0]">ציון</span>
                <span className="text-[#C5A059] font-mono font-bold">{risk_score}/100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8892B0]">דירוג</span>
                <span className="text-white">{rating} — {rating_label}</span>
              </div>
              {requires_manual_review && (
                <div className="pt-2 border-t border-[#1e2d4a]">
                  <span className="text-amber-400 text-xs">נדרשת בדיקה ידנית</span>
                </div>
              )}
            </div>
          </div>

          <button onClick={handleSave} disabled={!decision || saving || !caseId}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
              saved ? 'bg-green-500/20 border border-green-500/40 text-green-400'
              : decision ? 'bg-[#C5A059] hover:bg-[#D4AF37] text-[#0A0F1A] shadow-lg shadow-[#C5A059]/20'
              : 'bg-[#1e2d4a] text-[#4a5568] cursor-not-allowed'
            }`}>
            {saving ? 'שומר...' : saved ? 'נשמר בהצלחה' : 'שמור החלטה'}
          </button>

          {onPrint && (
            <button onClick={onPrint}
              className="w-full py-3 rounded-xl border border-[#C5A059] text-[#C5A059] text-sm hover:bg-[#C5A059]/10 transition-all flex items-center justify-center gap-2 font-semibold bg-[#C5A059]/5">
              <FileText className="w-4 h-4" />
              פתח תיק הגשה מוסדי (הדפסה / PDF)
            </button>
          )}


          <WhatIfSimulator scoreObject={scoreObject} caseData={null} />

          <button onClick={onReload}
            className="w-full py-2.5 rounded-xl border border-[#C5A059]/40 bg-[#C5A059]/5 text-[#C5A059] text-sm hover:bg-[#C5A059]/15 hover:border-[#C5A059]/60 transition-all font-semibold flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4" />
            נתח מחדש (מחיקת Cache)
          </button>

          {onReset && (
            <button onClick={onReset}
              className="w-full py-2 rounded-xl border border-[#1e2d4a] text-[#4a5568] text-sm hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-2">
              <RotateCcw className="w-3.5 h-3.5" />
              התחל מחדש
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
