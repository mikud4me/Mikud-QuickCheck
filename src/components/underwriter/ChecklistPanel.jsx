import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle, MinusCircle, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const STATUS_CONFIG = {
    present:      { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'קיים' },
    missing:      { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',         label: 'חסר' },
    partial:      { icon: AlertCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',     label: 'חלקי' },
    not_required: { icon: MinusCircle,  color: 'text-slate-500',   bg: 'bg-slate-500/10 border-slate-500/20',     label: 'לא נדרש' },
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function ChecklistItem({ item }) {
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.not_required;
    const Icon = cfg.icon;
    return (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all ${cfg.bg}`}>
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white text-sm font-medium">{item.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                    </span>
                    {item.priority === 'critical' && item.status !== 'present' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-400 font-bold">
                            קריטי
                        </span>
                    )}
                </div>
                {item.note && (
                    <p className="text-[#8892B0] text-xs mt-0.5">{item.note}</p>
                )}
            </div>
        </div>
    );
}

export default function ChecklistPanel({ checklist }) {
    const [collapsed, setCollapsed] = useState(false);
    const [filterStatus, setFilterStatus] = useState('all');

    if (!checklist?.items?.length) return null;

    const { items, summary } = checklist;

    // Group by category
    const grouped = {};
    [...items]
        .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
        .forEach(item => {
            if (!grouped[item.category]) grouped[item.category] = [];
            grouped[item.category].push(item);
        });

    const filtered = filterStatus === 'all' ? items
        : items.filter(i => i.status === filterStatus);

    const filteredGrouped = {};
    filtered.forEach(item => {
        if (!filteredGrouped[item.category]) filteredGrouped[item.category] = [];
        filteredGrouped[item.category].push(item);
    });

    const completionColor = summary.completion_pct >= 80 ? '#22c55e'
        : summary.completion_pct >= 50 ? '#f59e0b' : '#ef4444';

    return (
        <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-2xl overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setCollapsed(c => !c)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#C5A059]/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#C5A059]/10 flex items-center justify-center">
                        <ClipboardList className="w-4 h-4 text-[#C5A059]" />
                    </div>
                    <div className="text-right">
                        <p className="text-white font-bold text-sm">רשימת תיעוד — Checklist</p>
                        <p className="text-[#8892B0] text-xs">
                            {summary.present}/{summary.total} מסמכים
                            {summary.critical_missing > 0 && (
                                <span className="text-red-400 mr-2">· {summary.critical_missing} קריטיים חסרים</span>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {/* Progress circle */}
                    <div className="relative w-10 h-10">
                        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e2d4a" strokeWidth="3" />
                            <circle
                                cx="18" cy="18" r="15.9" fill="none"
                                stroke={completionColor}
                                strokeWidth="3"
                                strokeDasharray={`${summary.completion_pct} ${100 - summary.completion_pct}`}
                                strokeLinecap="round"
                            />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                            {summary.completion_pct}%
                        </span>
                    </div>
                    {collapsed ? <ChevronDown className="w-4 h-4 text-[#8892B0]" /> : <ChevronUp className="w-4 h-4 text-[#8892B0]" />}
                </div>
            </button>

            <AnimatePresence>
                {!collapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                    >
                        {/* Summary chips */}
                        <div className="px-6 pb-4 flex flex-wrap gap-2 border-b border-[#1e2d4a]">
                            {[
                                { key: 'all', label: `הכל (${summary.total})`, color: 'text-[#C5A059] border-[#C5A059]/40' },
                                { key: 'present', label: `קיים (${summary.present})`, color: 'text-emerald-400 border-emerald-500/40' },
                                { key: 'missing', label: `חסר (${summary.missing})`, color: 'text-red-400 border-red-500/40' },
                                { key: 'partial', label: `חלקי (${summary.partial})`, color: 'text-amber-400 border-amber-500/40' },
                            ].map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilterStatus(f.key)}
                                    className={`text-xs px-3 py-1 rounded-lg border transition-all font-semibold ${f.color} ${filterStatus === f.key ? 'bg-white/10' : 'opacity-50 hover:opacity-80'}`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>

                        {/* Items by category */}
                        <div className="px-6 py-4 space-y-5">
                            {Object.entries(filteredGrouped).map(([cat, catItems]) => (
                                <div key={cat}>
                                    <p className="text-[#4a5568] text-xs font-bold uppercase tracking-widest mb-2">{cat}</p>
                                    <div className="space-y-2">
                                        {catItems.map(item => (
                                            <ChecklistItem key={item.id} item={item} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {filtered.length === 0 && (
                                <p className="text-[#4a5568] text-sm text-center py-4">אין פריטים בסינון זה</p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}