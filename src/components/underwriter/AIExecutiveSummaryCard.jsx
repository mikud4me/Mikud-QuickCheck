import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

/**
 * AIExecutiveSummaryCard — תקציר מנהלים חיתומי שנכתב על ידי AI post-merge.
 * מוצג בראש דוח החיתום המוסדי, מיד אחרי פרטי הלווים.
 * כשאין תקציר — מציג fallback עם כפתור "נתח מחדש".
 */
export default function AIExecutiveSummaryCard({ summary, onRegenerate }) {
  const [expanded, setExpanded] = useState(true);

  // Fallback כשאין תקציר
  if (!summary) {
    return (
      <div
        className="relative overflow-hidden rounded-2xl border border-[#C5A059]/20 bg-gradient-to-br from-[#0f1a0d]/60 via-[#101510]/60 to-[#0d1524]/60"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)' }}
      >
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#C5A059]/30 to-transparent" />
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="w-10 h-10 rounded-xl bg-[#C5A059]/10 border border-[#C5A059]/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-[#C5A059]/50" />
          </div>
          <div className="flex-1">
            <h3 className="text-[#C5A059]/70 font-bold text-sm tracking-wider">💡 תקציר מנהלים — חוות דעת חיתומית</h3>
            <p className="text-[#8892B0]/70 text-xs mt-0.5">תקציר מנהלים לא קיים בגרסה זו — לחץ "נתח מחדש" להפקתו</p>
          </div>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-2 text-xs text-[#C5A059] border border-[#C5A059]/40 hover:border-[#C5A059] hover:bg-[#C5A059]/10 px-3 py-1.5 rounded-lg transition-all shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              נתח מחדש
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#C5A059]/40 bg-gradient-to-br from-[#0f1a0d] via-[#101510] to-[#0d1524]"
      style={{ boxShadow: '0 0 50px rgba(197,160,89,0.10), inset 0 0 0 1px rgba(255,255,255,0.03)' }}
    >
      {/* Gold shimmer top border */}
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#C5A059]/70 to-transparent" />

      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-6 py-4 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-[#C5A059]/15 border border-[#C5A059]/40 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[#D4AF37] font-bold text-sm tracking-wider">💡 תקציר מנהלים — חוות דעת חיתומית</h3>
            <span className="text-[10px] text-[#C5A059]/60 border border-[#C5A059]/25 px-1.5 py-0.5 rounded hidden sm:inline">AI · claude sonnet</span>
          </div>
          <p className="text-[#8892B0] text-xs mt-0.5">ניתוח איכותני שנכתב על בסיס הנתונים הממוזגים המלאים</p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-[#C5A059]/60 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-[#C5A059]/60 shrink-0" />
        }
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-6 pb-6">
          <div className="border-t border-[#C5A059]/15 pt-4">
            {summary.split('\n').filter(Boolean).map((para, i) => (
              <p key={i} className="text-[#ccd6f6] text-sm leading-relaxed mb-3 last:mb-0">
                {para}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}