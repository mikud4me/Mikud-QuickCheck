import React, { useState } from 'react';
import {
  X, CheckCircle2, AlertTriangle, XCircle, FileText, Shield,
  TrendingUp, CreditCard, Home, User, Clock, ChevronRight
} from 'lucide-react';

const FIELD_LABELS = {
  full_name: 'שם מלא',
  id_number: 'מספר תעודת זהות',
  employer: 'שם מעסיק',
  gross_salary: 'שכר ברוטו',
  net_salary: 'שכר נטו',
  bank_name: 'שם הבנק',
  account_number: 'מספר חשבון',
  monthly_income: 'הכנסה חודשית ממוצעת',
  balance: 'יתרה בחשבון',
  expiry_date: 'תוקף תעודת זהות',
  address: 'כתובת',
  annual_income: 'הכנסה שנתית',
  tax_year: 'שנת מס',
};

const STATUS_CONFIG = {
  verified: {
    label: 'תואם ✓',
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    barColor: '#10b981',
  },
  mismatch: {
    label: 'אי-התאמה ✗',
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
    barColor: '#ef4444',
  },
  missing: {
    label: 'חסר',
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    barColor: '#f59e0b',
  },
  unverified: {
    label: 'לא נבדק',
    icon: Clock,
    color: 'text-[#8892B0]',
    bg: 'bg-[#1e2d4a]/50 border-[#1e2d4a]',
    barColor: '#4a5568',
  },
};

const DOC_TYPE_LABELS = {
  salary_slip: 'תלוש שכר',
  bank_statement: 'דף חשבון בנק',
  tax_report: 'שומת מס / דוח שנתי',
  employment_letter: 'מכתב מעסיק',
  mortgage_statement: 'יתרת סילוק משכנתא',
  id_card: 'תעודת זהות',
  pension_slip: 'תלוש פנסיה',
  cpa_letter: 'מכתב רואה חשבון',
  sabbatical_letter: 'מכתב שבתון',
  return_to_work_letter: 'מכתב חזרה לעבודה',
  property_registry: 'נסח טאבו',
  loan_statement: 'יתרת הלוואה',
  other: 'מסמך אחר',
};

const DOC_ICONS = {
  salary_slip: TrendingUp,
  bank_statement: CreditCard,
  id_card: User,
  mortgage_statement: Home,
  tax_report: Shield,
};

function FieldRow({ label, value, status, crossMatch }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unverified;
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border p-4 ${cfg.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[#8892B0] text-xs mb-1">{label}</p>
          <p className="text-white text-sm font-bold">
            {value !== null && value !== undefined && value !== ''
              ? (typeof value === 'number' ? `₪${value.toLocaleString('he-IL')}` : String(value))
              : '—'}
          </p>
          {crossMatch !== null && crossMatch !== undefined && crossMatch !== '' && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <ChevronRight className="w-3 h-3 text-[#4a5568] shrink-0" />
              <p className="text-[#8892B0] text-xs">
                הצהרה / מקור אחר: <span className="text-[#c8d4e0] font-medium">
                  {typeof crossMatch === 'number' ? `₪${crossMatch.toLocaleString('he-IL')}` : String(crossMatch)}
                </span>
              </p>
            </div>
          )}
        </div>
        <div className={`flex items-center gap-1.5 shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-lg border ${cfg.bg} ${cfg.color}`}>
          <Icon className="w-3.5 h-3.5" />
          {cfg.label}
        </div>
      </div>
    </div>
  );
}

function ScoreMeter({ verifiedCount, totalCount }) {
  const pct = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-bold font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

export default function DocumentVerificationModal({ doc, onClose }) {
  const [activeTab, setActiveTab] = useState('fields');
  if (!doc) return null;

  const DocIcon = DOC_ICONS[doc.document_type] || FileText;
  const docTypeLabel = DOC_TYPE_LABELS[doc.document_type] || doc.document_type;
  const extracted = doc.extracted_data || {};

  const fields = Object.entries(extracted)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, value]) => ({
      key,
      label: FIELD_LABELS[key] || key,
      value,
      status: doc.field_statuses?.[key] || 'unverified',
      crossMatch: doc.cross_match?.[key],
    }));

  const verifiedFields = fields.filter(f => f.status === 'verified').length;
  const mismatchFields = fields.filter(f => f.status === 'mismatch').length;
  const overallStatus = doc.overall_status || 'unverified';
  const overallCfg = STATUS_CONFIG[overallStatus] || STATUS_CONFIG.unverified;
  const OverallIcon = overallCfg.icon;

  const tabs = [
    { key: 'fields', label: 'נתונים שחולצו', count: fields.length },
    { key: 'mismatches', label: 'אי-התאמות', count: doc.mismatches?.length || 0, danger: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#0A0F1A] border border-[#1e2d4a] rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl shadow-black/60">

        {/* Header */}
        <div className="bg-[#0d1524] border-b border-[#1e2d4a] px-6 py-5 rounded-t-2xl shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${overallCfg.bg}`}>
                <DocIcon className={`w-5 h-5 ${overallCfg.color}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-bold text-base">{docTypeLabel}</p>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${overallCfg.bg} ${overallCfg.color}`}>
                    <OverallIcon className="w-3.5 h-3.5" />
                    {overallCfg.label}
                  </div>
                </div>
                <p className="text-[#8892B0] text-xs mt-0.5">{doc.verification_summary || doc.file_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-[#4a5568] hover:text-white transition-colors mt-1 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Score meter */}
          <div className="mt-4 bg-[#080d16] rounded-xl p-3">
            <div className="flex justify-between text-xs text-[#8892B0] mb-2">
              <span>שלמות אימות</span>
              <span>{verifiedFields}/{fields.length} שדות אומתו</span>
            </div>
            <ScoreMeter verifiedCount={verifiedFields} totalCount={fields.length} />
            {mismatchFields > 0 && (
              <p className="text-red-400 text-xs mt-1.5 font-medium">⚠ {mismatchFields} שדות עם אי-התאמה</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#080d16] border-b border-[#1e2d4a] px-6 py-2 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.key
                  ? tab.danger ? 'bg-red-500/20 text-red-400' : 'bg-[#C5A059]/20 text-[#C5A059]'
                  : 'text-[#8892B0] hover:text-white'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab.key ? 'bg-white/10' : 'bg-[#1e2d4a]'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">

          {activeTab === 'fields' && (
            <>
              {fields.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-10 h-10 text-[#4a5568] mx-auto mb-3" />
                  <p className="text-[#8892B0] text-sm">לא חולצו נתונים ממסמך זה</p>
                </div>
              ) : (
                fields.map((field, i) => (
                  <FieldRow
                    key={i}
                    label={field.label}
                    value={field.value}
                    status={field.status}
                    crossMatch={field.crossMatch}
                  />
                ))
              )}
            </>
          )}

          {activeTab === 'mismatches' && (
            <>
              {!doc.mismatches || doc.mismatches.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400/50 mx-auto mb-3" />
                  <p className="text-emerald-400 text-sm font-medium">לא זוהו אי-התאמות במסמך זה</p>
                  <p className="text-[#8892B0] text-xs mt-1">כל הנתונים תואמים בין המקורות</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 mb-4">
                    <p className="text-red-400 text-sm font-semibold mb-1">נדרשת תשומת לב</p>
                    <p className="text-[#8892B0] text-xs">האי-התאמות הבאות זוהו בניתוח הצולב של המסמך. יש לבדוק ולאמת ידנית.</p>
                  </div>
                  {doc.mismatches.map((m, i) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-300 text-sm leading-relaxed">{m}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1e2d4a] px-6 py-4 bg-[#0d1524] rounded-b-2xl shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-[#4a5568] text-xs">ניתוח מסמכים אוטומטי — AI | אין לראות כאישור משפטי</p>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-[#1e2d4a] hover:bg-[#C5A059]/20 border border-[#1e2d4a] hover:border-[#C5A059]/40 text-[#8892B0] hover:text-[#C5A059] rounded-xl text-sm font-medium transition-all"
            >
              סגור
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}