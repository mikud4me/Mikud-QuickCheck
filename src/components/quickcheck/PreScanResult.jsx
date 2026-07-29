import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText, Building2, User, CreditCard, Briefcase, Baby, Zap, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import IdentityLockBadge from './IdentityLockBadge';
import { downloadScanSummaryPdf } from '@/components/lib/scanPdfExport';

const DOC_LABELS = {
    id_card: { label: 'תעודת זהות', icon: User },
    payslip: { label: 'תלושי שכר', icon: FileText },
    bank_statement: { label: 'דפי עובר ושב', icon: CreditCard },
    mortgage_balance: { label: 'יתרת סילוק / משכנתא קיימת', icon: Building2 },
    tax_assessment: { label: 'שומת מס', icon: Briefcase },
    cpa_letter: { label: 'מכתב רו"ח', icon: Briefcase },
    employment_letter: { label: 'מכתב מעסיק / אישור', icon: FileText },
    pension_slip: { label: 'תלוש פנסיה / קצבה', icon: FileText },
    property_doc: { label: 'מסמכי נכס / טאבו', icon: Building2 },
    other: { label: 'אחר', icon: FileText },
};

const SUGGESTED_TYPE_META = {
    'מחזור משכנתא': { emoji: '🏠', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
    'רכישת נכס חדש': { emoji: '🏡', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
    'בעלי עסקים וחברות': { emoji: '💼', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
    'גיל הזהב': { emoji: '👴', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    'מיחזור משכנתא ואיחוד חובות': { emoji: '🏦', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
};

export default function PreScanResult({ scanResult, onSuggestType, onRunAnalysis }) {
    const [isExportingSummary, setIsExportingSummary] = useState(false);

    if (!scanResult) return null;

    const {
        found_documents = [],
        missing_critical = [],
        borrower_names = [],
        suggested_report_type,
        additional_suggested_types = [],
        scan_notes,
        estimated_total_pages,
        irrelevant_pages_estimate,
        identity_lock
    } = scanResult;

    // Build full list: primary + additional
    const allSuggested = [
        ...(suggested_report_type ? [suggested_report_type] : []),
        ...additional_suggested_types.filter(t => t !== suggested_report_type)
    ];

    const handleSelect = (e, type) => {
        if (e && e.preventDefault) e.preventDefault();
        if (onSuggestType) {
            onSuggestType(type);
        }
        if (onRunAnalysis) {
            toast.success(`✅ סוג תיק נבחר: ${type} — מתחיל ניתוח מלא...`);
            setTimeout(() => onRunAnalysis(type), 300);
        }
    };

    const handleExportSummary = async () => {
        setIsExportingSummary(true);
        try {
            await downloadScanSummaryPdf(scanResult);
            toast.success('✅ הדוח הורד בהצלחה!');
        } catch (err) {
            console.error('downloadScanSummaryPdf failed:', err);
            toast.error('שגיאה בהורדת הדוח');
        } finally {
            setIsExportingSummary(false);
        }
    };

    return (
        <div className="bg-slate-800/80 border border-slate-600/50 rounded-2xl overflow-hidden mb-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-700/80 to-slate-800/80 px-5 py-4 border-b border-slate-700/50 flex items-center flex-wrap gap-3">
                <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                    <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1">
                    <div className="text-white font-bold text-sm">סריקת מסמכים הושלמה</div>
                    <div className="text-slate-400 text-xs">
                        {estimated_total_pages > 0 && `${estimated_total_pages} עמודים סרוקו`}
                        {irrelevant_pages_estimate > 0 && ` | ~${irrelevant_pages_estimate} עמ' לא רלוונטיים`}
                        {borrower_names.length > 0 && ` | זוהו: ${borrower_names.join(', ')}`}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleExportSummary}
                        disabled={isExportingSummary}
                        className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-700/60 hover:bg-slate-600 border border-slate-600 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        title="הורדת רשימת מסמכים שנמצאו וחסרים כקובץ PDF"
                    >
                        {isExportingSummary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        הורד דוח כ-PDF
                    </button>
                </div>
            </div>

            <div className="p-5 space-y-4">
                {/* Identity Lock — Gatekeeper */}
                {identity_lock && (
                    <IdentityLockBadge identityLock={identity_lock} />
                )}

                {/* Suggestion banners */}
                {allSuggested.length > 0 && (
                    <div className="space-y-2">
                        {allSuggested.map((type, idx) => {
                            const meta = SUGGESTED_TYPE_META[type];
                            if (!meta) return null;
                            return (
                                <div key={type} className={`flex items-center justify-between p-3 rounded-xl border ${meta.bg}`}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{meta.emoji}</span>
                                        <div>
                                            <div className="text-xs text-slate-400">
                                                {idx === 0 ? 'סוג תיק מוצע' : 'סוג נוסף שזוהה'}
                                            </div>
                                            <div className={`font-bold text-sm ${meta.color}`}>{type}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => handleSelect(e, type)}
                                        className={`text-xs font-bold text-white px-3 py-1.5 rounded-lg transition-all border ${
                                            idx === 0
                                                ? 'bg-amber-500 hover:bg-amber-400 border-amber-400 shadow-lg shadow-amber-900/30'
                                                : 'bg-slate-700 hover:bg-slate-600 border-slate-600'
                                        }`}
                                    >
                                        {onRunAnalysis ? '⚡ הפק דוח' : 'בחר →'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Special flags */}
                {(scanResult.has_sabbatical_indicator || scanResult.has_maternity_indicator || scanResult.has_business_indicator) && (
                    <div className="flex flex-wrap gap-2">
                        {scanResult.has_sabbatical_indicator && (
                            <span className="flex items-center gap-1 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full text-xs font-bold text-yellow-400">
                                <AlertTriangle className="w-3 h-3" /> זוהה שבתון
                            </span>
                        )}
                        {scanResult.has_maternity_indicator && (
                            <span className="flex items-center gap-1 px-3 py-1 bg-pink-500/10 border border-pink-500/30 rounded-full text-xs font-bold text-pink-400">
                                <Baby className="w-3 h-3" /> זוהתה חופשת לידה
                            </span>
                        )}
                        {scanResult.has_business_indicator && (
                            <span className="flex items-center gap-1 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full text-xs font-bold text-purple-400">
                                <Briefcase className="w-3 h-3" /> זוהה תיק עסקי
                            </span>
                        )}
                    </div>
                )}

                {/* Found documents */}
                {found_documents.length > 0 && (
                    <div>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">נמצא בתיק</div>
                        <div className="space-y-1.5">
                            {found_documents.map((doc, i) => {
                                const meta = DOC_LABELS[doc.type] || DOC_LABELS.other;
                                const Icon = meta.icon;
                                return (
                                    <div key={i} className="flex items-start gap-3 bg-slate-900/40 rounded-lg px-3 py-2">
                                        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                                        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                        <span className="text-sm text-white font-medium w-28 shrink-0">{meta.label}</span>
                                        {doc.count > 0 && (
                                            <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full shrink-0">
                                                {doc.count}
                                            </span>
                                        )}
                                        {doc.details && (
                                            <span className="text-xs text-slate-400 leading-relaxed">{doc.details}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Missing critical */}
                {missing_critical.length > 0 && (
                    <div>
                        <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">חסר בתיק</div>
                        <div className="space-y-1.5">
                            {missing_critical.map((doc, i) => (
                                <div key={i} className="flex items-center gap-3 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                                    <span className="text-sm text-red-300 font-medium">{doc}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Scan notes */}
                {scan_notes && (
                    <div className="bg-slate-900/40 rounded-lg px-3 py-2.5 text-xs text-slate-400 border border-slate-700/50 leading-relaxed">
                        <span className="text-slate-500 font-bold">📝 </span>{scan_notes}
                    </div>
                )}
            </div>
        </div>
    );
}