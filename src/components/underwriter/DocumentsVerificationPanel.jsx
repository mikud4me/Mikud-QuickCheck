import React, { useState } from 'react';
import { FileText, CheckCircle2, AlertTriangle, XCircle, Eye, Shield, TrendingUp, CreditCard, Home, User, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import DocumentVerificationModal from './DocumentVerificationModal';

const DOC_TYPE_LABELS = {
  salary_slip: 'תלוש שכר',
  bank_statement: 'דף חשבון בנק',
  tax_report: 'שומת מס',
  employment_letter: 'מכתב מעסיק',
  mortgage_statement: 'יתרת משכנתא',
  id_card: 'תעודת זהות',
  pension_slip: 'תלוש פנסיה',
  cpa_letter: 'מכתב רואה חשבון',
  sabbatical_letter: 'מכתב שבתון',
  return_to_work_letter: 'מכתב חזרה לעבודה',
  property_registry: 'נסח טאבו',
  loan_statement: 'יתרת הלוואה',
  other: 'מסמך אחר',
};

const DOC_TYPE_ICONS = {
  salary_slip: TrendingUp,
  bank_statement: CreditCard,
  id_card: User,
  mortgage_statement: Home,
  tax_report: Shield,
};

const STATUS_CONFIG = {
  verified: {
    label: 'אומת',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    dot: 'bg-emerald-400',
    icon: CheckCircle2,
  },
  mismatch: {
    label: 'אי-התאמה',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
    dot: 'bg-red-400',
    icon: XCircle,
  },
  missing: {
    label: 'חסר',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
    dot: 'bg-amber-400',
    icon: AlertTriangle,
  },
  unverified: {
    label: 'ממתין',
    color: 'text-[#8892B0]',
    bg: 'bg-[#1e2d4a]/40 border-[#1e2d4a]',
    dot: 'bg-[#4a5568]',
    icon: Clock,
  },
};

// Group documents by type for organized display
function groupDocuments(documents) {
  const groups = {};
  documents.forEach(doc => {
    const type = doc.document_type || 'other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(doc);
  });
  return groups;
}

function DocumentCard({ doc, index, onView }) {
  const status = doc.overall_status || 'unverified';
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unverified;
  const StatusIcon = cfg.icon;
  const DocIcon = DOC_TYPE_ICONS[doc.document_type] || FileText;
  const label = DOC_TYPE_LABELS[doc.document_type] || 'מסמך';

  // Extract key data point to show on card
  const keyData = doc.extracted_data?.net_salary
    ? `₪${Number(doc.extracted_data.net_salary).toLocaleString('he-IL')} נטו`
    : doc.extracted_data?.gross_salary
    ? `₪${Number(doc.extracted_data.gross_salary).toLocaleString('he-IL')} ברוטו`
    : doc.extracted_data?.balance
    ? `₪${Number(doc.extracted_data.balance).toLocaleString('he-IL')} יתרה`
    : doc.extracted_data?.monthly_income
    ? `₪${Number(doc.extracted_data.monthly_income).toLocaleString('he-IL')}/חודש`
    : null;

  const hasMismatches = doc.mismatches && doc.mismatches.length > 0;

  return (
    <div
      className={`relative group border rounded-xl p-4 cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-lg ${
        status === 'mismatch'
          ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50'
          : status === 'verified'
          ? 'bg-[#080d16] border-[#1e2d4a] hover:border-emerald-500/30'
          : 'bg-[#080d16] border-[#1e2d4a] hover:border-[#C5A059]/30'
      }`}
      onClick={() => onView(doc)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${cfg.bg}`}>
            <DocIcon className={`w-4 h-4 ${cfg.color}`} />
          </div>
          <div>
            <p className="text-white text-sm font-semibold">{label}</p>
            <p className="text-[#8892B0] text-xs truncate max-w-[160px]">
              {doc.verification_summary?.split('—')[1]?.trim() || doc.file_name || ''}
            </p>
          </div>
        </div>

        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </div>
      </div>

      {/* Key extracted data */}
      {keyData && (
        <div className="bg-[#0A0F1A] rounded-lg px-3 py-2 mb-3">
          <p className="text-[#8892B0] text-xs">נתון מרכזי שחולץ</p>
          <p className="text-[#C5A059] text-sm font-bold font-mono">{keyData}</p>
        </div>
      )}

      {/* Field status mini-grid */}
      {doc.field_statuses && Object.keys(doc.field_statuses).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {Object.entries(doc.field_statuses).slice(0, 5).map(([key, st]) => {
            const s = STATUS_CONFIG[st] || STATUS_CONFIG.unverified;
            return (
              <span key={key} className={`text-xs px-1.5 py-0.5 rounded border ${s.bg} ${s.color}`}>
                {key === 'full_name' ? 'שם' : key === 'id_number' ? 'ת.ז' : key === 'employer' ? 'מעסיק' : key === 'net_salary' ? 'נטו' : key === 'gross_salary' ? 'ברוטו' : key === 'bank_name' ? 'בנק' : key === 'monthly_income' ? 'הכנסה' : key === 'expiry_date' ? 'תוקף' : key}
              </span>
            );
          })}
        </div>
      )}

      {/* Mismatch warning */}
      {hasMismatches && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
          <p className="text-red-400 text-xs font-medium">⚠ {doc.mismatches[0]}</p>
          {doc.mismatches.length > 1 && (
            <p className="text-red-400/60 text-xs">ועוד {doc.mismatches.length - 1} אי-התאמות</p>
          )}
        </div>
      )}

      {/* Hover CTA */}
      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#0A0F1A]/80 opacity-0 group-hover:opacity-100 transition-all duration-200">
        <div className="flex items-center gap-2 bg-[#C5A059] text-[#0A0F1A] px-4 py-2 rounded-xl font-bold text-sm shadow-lg">
          <Eye className="w-4 h-4" />
          פתח דוח אימות מלא
        </div>
      </div>
    </div>
  );
}

function GroupSection({ type, docs, onView }) {
  const [collapsed, setCollapsed] = useState(false);
  const label = DOC_TYPE_LABELS[type] || type;
  const verifiedCount = docs.filter(d => d.overall_status === 'verified').length;
  const mismatchCount = docs.filter(d => d.overall_status === 'mismatch').length;

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-2 px-1 group"
      >
        <div className="flex items-center gap-2">
          <p className="text-[#8892B0] text-xs font-semibold uppercase tracking-wider">{label}</p>
          <span className="text-xs bg-[#1e2d4a] text-[#8892B0] px-1.5 py-0.5 rounded">{docs.length}</span>
          {verifiedCount > 0 && <span className="text-xs text-emerald-400">✓ {verifiedCount} אומתו</span>}
          {mismatchCount > 0 && <span className="text-xs text-red-400">⚠ {mismatchCount} אי-התאמות</span>}
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-[#4a5568] group-hover:text-[#8892B0]" />
          : <ChevronUp className="w-4 h-4 text-[#4a5568] group-hover:text-[#8892B0]" />
        }
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((doc, i) => (
            <DocumentCard key={i} doc={doc} index={i} onView={onView} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentsVerificationPanel({ documents }) {
  const [selectedDoc, setSelectedDoc] = useState(null);

  if (!documents || documents.length === 0) return null;

  const verifiedCount = documents.filter(d => d.overall_status === 'verified').length;
  const mismatchCount = documents.filter(d => d.overall_status === 'mismatch').length;
  const pendingCount = documents.filter(d => !d.overall_status || d.overall_status === 'unverified').length;
  const groups = groupDocuments(documents);

  const completionPct = Math.round((verifiedCount / documents.length) * 100);

  return (
    <>
      <div className="bg-[#0d1524] border border-[#1e2d4a] rounded-2xl p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-1">ניתוח מסמכים</p>
            <p className="text-white font-bold text-lg">דוח אימות מסמכים מלא</p>
            <p className="text-[#8892B0] text-xs mt-0.5">לחץ על כל מסמך לפרטי הניתוח הצולב המלא</p>
          </div>
          <div className="text-left">
            <div className="text-3xl font-black font-mono text-white">{completionPct}%</div>
            <div className="text-[#8892B0] text-xs">שלמות אימות</div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'סה"כ מסמכים', value: documents.length, color: 'text-white', border: 'border-[#1e2d4a]' },
            { label: 'אומתו', value: verifiedCount, color: 'text-emerald-400', border: 'border-emerald-500/30' },
            { label: 'אי-התאמות', value: mismatchCount, color: 'text-red-400', border: 'border-red-500/30' },
            { label: 'ממתינים', value: pendingCount, color: 'text-[#8892B0]', border: 'border-[#1e2d4a]' },
          ].map((stat, i) => (
            <div key={i} className={`bg-[#080d16] border ${stat.border} rounded-xl p-3 text-center`}>
              <div className={`text-2xl font-black font-mono ${stat.color}`}>{stat.value}</div>
              <div className="text-[#8892B0] text-xs mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="h-1.5 bg-[#080d16] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${completionPct}%`,
                background: mismatchCount > 0
                  ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                  : 'linear-gradient(90deg, #10b981, #059669)'
              }}
            />
          </div>
        </div>

        {/* Grouped document cards */}
        {Object.entries(groups).map(([type, docs]) => (
          <GroupSection key={type} type={type} docs={docs} onView={setSelectedDoc} />
        ))}

      </div>

      {/* Modal */}
      {selectedDoc && (
        <DocumentVerificationModal
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </>
  );
}