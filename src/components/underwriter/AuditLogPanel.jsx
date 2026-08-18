import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { History, Eye, Download, Edit2, Lock } from 'lucide-react';

const ACTION_CONFIG = {
  view:        { icon: Eye,      label: 'צפייה בתיק',     color: 'text-sky-400',     bg: 'bg-sky-500/10 border-sky-500/20' },
  export:      { icon: Download, label: 'הורדת PDF',       color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  edit:        { icon: Edit2,    label: 'עריכה / שינוי',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
  data_access: { icon: Lock,     label: 'גישה לנתונים רגישים', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
};

/**
 * AuditLogPanel — read-only (immutable) action log panel.
 * Shown at the bottom of every case for regulatory compliance.
 *
 * MIGRATION NOTE (Base44 → Supabase): base44.entities.AuditLog.filter →
 * supabase.from('audit_log').select(...). created_date (Base44 auto field) →
 * created_at (this repo's actual column name).
 */
export default function AuditLogPanel({ caseId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data: all } = await supabase
          .from('audit_log')
          .select('*')
          .eq('target_id', caseId)
          .order('created_at', { ascending: false })
          .limit(50);
        setLogs(all || []);
      } catch { setLogs([]); }
      finally { setLoading(false); }
    };
    load();
  }, [caseId]);

  const formatTime = (ts) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('he-IL', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return ts; }
  };

  return (
    <div className="bg-[#0d1524]/70 backdrop-blur-xl border border-[#C5A059]/18 rounded-2xl overflow-hidden shadow-xl shadow-black/40">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1e2d4a] bg-[#080d16]">
        <History className="w-4 h-4 text-[#C5A059]" />
        <div>
          <p className="text-white text-sm font-semibold">יומן פעולות — Audit Log</p>
          <p className="text-[#4a5568] text-xs">תיעוד בלתי ניתן למחיקה · סטנדרט בנקאי</p>
        </div>
        <span className="mr-auto text-xs text-[#4a5568] border border-[#1e2d4a] px-2 py-0.5 rounded">
          Read Only
        </span>
      </div>

      {/* Log entries */}
      <div className="divide-y divide-[#0d1524] max-h-64 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-6 text-center text-[#4a5568] text-xs">טוען יומן...</div>
        ) : logs.length === 0 ? (
          <div className="px-5 py-6 text-center text-[#4a5568] text-xs">אין פעולות מתועדות לתיק זה</div>
        ) : logs.map((log, i) => {
          const cfg = ACTION_CONFIG[log.action_type] || ACTION_CONFIG.view;
          const Icon = cfg.icon;
          return (
            <div key={log.id || i} className="flex items-center gap-3 px-5 py-3 hover:bg-[#0a1020] transition-colors">
              {/* Action icon */}
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${cfg.bg}`}>
                <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium">{log.description || cfg.label}</p>
                <p className="text-[#4a5568] text-xs truncate">{log.user_email}</p>
              </div>

              {/* Time */}
              <p className="text-[#4a5568] text-xs shrink-0 font-mono">
                {formatTime(log.created_at)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
