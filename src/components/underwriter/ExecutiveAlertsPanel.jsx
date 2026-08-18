import React, { useState } from 'react';

const SEVERITY_CONFIG = {
  critical: { label: 'קריטי',  color: 'text-red-400',    border: 'border-red-500/30',    bg: 'bg-red-500/5',    bar: 'bg-red-500' },
  high:     { label: 'גבוה',   color: 'text-orange-400',  border: 'border-orange-500/30',  bg: 'bg-orange-500/5', bar: 'bg-orange-500' },
  medium:   { label: 'בינוני', color: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5',  bar: 'bg-amber-500' },
  low:      { label: 'נמוך',   color: 'text-blue-400',    border: 'border-blue-500/30',    bg: 'bg-blue-500/5',   bar: 'bg-blue-500' },
};

const MITIGANT_CONFIG = {
  high:   { color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', bar: 'bg-emerald-500' },
  medium: { color: 'text-emerald-400', border: 'border-emerald-500/25', bg: 'bg-emerald-500/5', bar: 'bg-emerald-400' },
  low:    { color: 'text-teal-400',    border: 'border-teal-500/25',    bg: 'bg-teal-500/5',    bar: 'bg-teal-500' },
};

function TrafficBar({ color }) {
  return <div className={`w-1 self-stretch rounded-full shrink-0 ${color}`} />;
}

function AlertItem({ item, type }) {
  const cfg = type === 'mitigant'
    ? MITIGANT_CONFIG[item.weight || 'medium']
    : SEVERITY_CONFIG[item.severity || 'medium'];

  return (
    <div className={`flex gap-3 border rounded-xl p-4 ${cfg.border} ${cfg.bg}`}>
      <TrafficBar color={cfg.bar} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-xs font-bold uppercase tracking-wider ${cfg.color}`}>{item.category}</span>
          {item.action_required && (
            <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded border border-red-500/25 font-medium">
              נדרשת פעולה
            </span>
          )}
          {type !== 'mitigant' && item.severity && (
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${cfg.color} ${cfg.border} bg-transparent`}>
              {SEVERITY_CONFIG[item.severity]?.label}
            </span>
          )}
        </div>
        <p className="text-[#c8d4e0] text-sm leading-relaxed">{item.finding}</p>
        {item.detail && <p className="text-[#4a5568] text-xs mt-1.5 leading-relaxed">{item.detail}</p>}
      </div>
    </div>
  );
}

const TAB_CONFIG = [
  { key: 'flags',    label: 'דגלים',          activeClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { key: 'warnings', label: 'אזהרות',         activeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { key: 'mitigants',label: 'גורמים מפצים',   activeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { key: 'docs',     label: 'מסמכים חסרים',   activeClass: 'bg-[#C5A059]/15 text-[#C5A059] border-[#C5A059]/30' },
];

export default function ExecutiveAlertsPanel({ alerts }) {
  const [activeTab, setActiveTab] = useState('flags');

  const counts = {
    flags:    alerts.red_flags.length,
    warnings: alerts.warnings.length,
    mitigants:alerts.mitigants.length,
    docs:     alerts.missing_docs.length,
  };

  return (
    <div className="bg-[#080e1a] border border-[#1a2640] rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-[#4a5568] text-xs uppercase tracking-[0.2em] mb-1">Executive Alerts</p>
          <p className="text-white font-bold text-base">ממצאים וסיכונים</p>
        </div>
        <div className="flex items-center gap-2">
          {(alerts.alert_summary.critical_count + alerts.alert_summary.high_count) > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/8 border border-red-500/25 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-400 text-xs font-semibold">
                {alerts.alert_summary.critical_count + alerts.alert_summary.high_count} קריטיים
              </span>
            </div>
          )}
          {alerts.alert_summary.mitigant_count > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/8 border border-emerald-500/25 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-400 text-xs font-semibold">
                {alerts.alert_summary.mitigant_count} מפצים
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {TAB_CONFIG.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                isActive ? tab.activeClass : 'text-[#8892B0] border-[#1a2640] hover:text-white hover:border-[#2a3a55]'
              }`}
            >
              {tab.label}
              <span className={`min-w-[18px] text-center rounded px-1 py-0.5 text-[11px] font-bold ${
                isActive ? 'bg-white/15' : 'bg-[#1a2640] text-[#4a5568]'
              }`}>
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="space-y-2.5">
        {activeTab === 'flags' && (
          alerts.red_flags.length === 0
            ? <EmptyState color="text-emerald-400" text="אין דגלים אדומים — תיק נקי" />
            : alerts.red_flags.map((item, i) => <AlertItem key={i} item={item} type="flag" />)
        )}
        {activeTab === 'warnings' && (
          alerts.warnings.length === 0
            ? <EmptyState color="text-[#8892B0]" text="אין אזהרות" />
            : alerts.warnings.map((item, i) => <AlertItem key={i} item={item} type="warning" />)
        )}
        {activeTab === 'mitigants' && (
          alerts.mitigants.length === 0
            ? <EmptyState color="text-[#8892B0]" text="לא זוהו גורמים מפצים" />
            : alerts.mitigants.map((item, i) => <AlertItem key={i} item={item} type="mitigant" />)
        )}
        {activeTab === 'docs' && (
          alerts.missing_docs.length === 0
            ? <EmptyState color="text-emerald-400" text="כל המסמכים הנדרשים קיימים" />
            : alerts.missing_docs.map((doc, i) => (
              <div key={i} className={`flex gap-3 border rounded-xl p-4 ${
                doc.priority === 'critical' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/25 bg-amber-500/5'
              }`}>
                <div className={`w-1 self-stretch rounded-full shrink-0 ${doc.priority === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div>
                  <span className={`text-xs font-bold uppercase tracking-wider block mb-1 ${doc.priority === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                    {doc.priority === 'critical' ? 'חובה' : 'נדרש'}
                  </span>
                  <span className="text-[#c8d4e0] text-sm">{doc.doc}</span>
                  {doc.note && <p className="text-[#4a5568] text-xs mt-1">{doc.note}</p>}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ color, text }) {
  return (
    <div className="py-8 text-center">
      <p className={`text-sm ${color}`}>{text}</p>
    </div>
  );
}