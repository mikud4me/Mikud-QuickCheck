import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

const STATUS_CONFIG = {
    ok:       { icon: ShieldCheck, color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',  label: 'זהות מאומתת' },
    warning:  { icon: ShieldAlert, color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30',  label: 'דורש אימות' },
    critical: { icon: ShieldX,     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/40',      label: 'בעיה קריטית' },
    no_id:    { icon: ShieldAlert, color: 'text-slate-400',  bg: 'bg-slate-700/40 border-slate-600/40',  label: 'אין ת.ז' },
};

const ISSUE_ICON = {
    critical: <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />,
    warning:  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />,
};

export default function IdentityLockBadge({ identityLock }) {
    const [expanded, setExpanded] = useState(false);

    if (!identityLock) return null;

    const { overall_status, issues = [], warnings = [], verified_items = [], summary } = identityLock;
    const config = STATUS_CONFIG[overall_status] || STATUS_CONFIG.warning;
    const Icon = config.icon;

    const allProblems = [
        ...issues.map(i => ({ ...i, severity: 'critical' })),
        ...warnings.map(w => ({ ...w, severity: 'warning' }))
    ];
    const hasDetails = allProblems.length > 0 || verified_items.length > 0;

    return (
        <div className={`rounded-xl border overflow-hidden ${config.bg}`}>
            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <Icon className={`w-5 h-5 ${config.color} shrink-0`} />
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-black uppercase tracking-widest ${config.color}`}>
                                Identity Lock
                            </span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${config.bg} ${config.color}`}>
                                {config.label}
                            </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5 leading-tight">{summary}</p>
                    </div>
                </div>
                {hasDetails && (
                    <button
                        onClick={() => setExpanded(p => !p)}
                        className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700/40"
                    >
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                )}
            </div>

            {/* Expanded details */}
            {expanded && hasDetails && (
                <div className="border-t border-white/5 px-4 py-3 space-y-1.5">
                    {/* Critical issues */}
                    {allProblems.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                            {ISSUE_ICON[item.severity]}
                            <span className={item.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}>
                                {item.message}
                            </span>
                        </div>
                    ))}
                    {/* Divider if both issues and verified */}
                    {allProblems.length > 0 && verified_items.length > 0 && (
                        <div className="border-t border-white/5 my-1" />
                    )}
                    {/* Verified items */}
                    {verified_items.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                            <span className="text-green-300">{item.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}