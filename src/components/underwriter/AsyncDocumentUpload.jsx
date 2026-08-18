import React, { useState, useRef, useLayoutEffect } from 'react';
import { supabase, uploadFileToStorage } from '@/api/supabaseClient';
import { Upload, FileText, X, Image, ChevronRight, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { expandLargePdfs } from '@/components/lib/pdfPageSplitter';
import DealSetupModal from './DealSetupModal';

const DOC_TYPES = [
  { value: 'salary_slip', label: 'תלוש שכר' },
  { value: 'bank_statement', label: 'דף חשבון בנק (עו"ש)' },
  { value: 'tax_report', label: 'שומת מס / דוח שנתי' },
  { value: 'employment_letter', label: 'מכתב מעסיק' },
  { value: 'mortgage_statement', label: 'יתרת סילוק משכנתא' },
  { value: 'id_card', label: 'תעודת זהות' },
  { value: 'pension_slip', label: 'תלוש פנסיה / גמלה' },
  { value: 'cpa_letter', label: 'מכתב רואה חשבון (עצמאי)' },
  { value: 'sabbatical_letter', label: 'מכתב שבתון' },
  { value: 'return_to_work_letter', label: 'מכתב חזרה לעבודה' },
  { value: 'property_registry', label: 'נסח טאבו' },
  { value: 'loan_statement', label: 'יתרת הלוואה' },
  { value: 'other', label: 'אחר' }
];

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff', 'image/bmp'];
const MAX_MB = 50; // Single Payload — merged binders up to 50MB

/**
 * AsyncDocumentUpload — async upload into מרכז חיתום מוסדי.
 * Flow: upload files → create a processing record immediately → detached
 * invoke → release the UI. onQueued(caseId) fires right after the case
 * enters the queue (a few seconds from the clerk's perspective).
 *
 * ── MIGRATION NOTE (Base44 → Supabase) ──
 * - base44.integrations.Core.UploadFile → uploadFileToStorage (returns the
 *   signed URL string directly, not a { file_url } object).
 * - base44.functions.invoke('extractSingleChunk'/'processUnderwriterCase') →
 *   supabase.functions.invoke(...), body wrapped in { body: {...} }, response
 *   shaped as { data, error } instead of Base44's { data, status }.
 * - base44.entities.MortgageCase.create → supabase.from('mortgage_cases').insert(...).select().single().
 */
export default function AsyncDocumentUpload({ wizardData, onQueued, onBack }) {
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [statusText, setStatusText] = useState('מעלה מסמכים לתור העיבוד');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  // ── Deal Setup: before uploading documents, collect deal context (purpose/value/amount) ──
  const [dealSetup, setDealSetup] = useState(null); // { dealContext, wizardData }
  // ── Prevents a scroll jump when moving from the "open case" screen (tall) to
  // the document upload screen (shorter). Without this, the browser "grabs"
  // scroll downward: the page height shrinks between renders and the browser
  // picks a new scroll position relative to the shorter height, causing a
  // "jump" feeling even though no scroll was intentionally triggered. ──
  const scrollYBeforeDealSetup = useRef(0);
  useLayoutEffect(() => {
    if (dealSetup) window.scrollTo(0, scrollYBeforeDealSetup.current);
  }, [dealSetup]);

  const isAccepted = (f) => ACCEPTED.includes(f.type) || f.name.match(/\.(pdf|jpg|jpeg|png|webp|heic|heif|tiff|bmp)$/i);

  const addFiles = (newFiles) => {
    const oversized = newFiles.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (oversized.length > 0) setError(`קבצים גדולים מ-${MAX_MB}MB: ${oversized.map(f => f.name).join(', ')}`);
    const valid = newFiles.filter(f => f.size <= MAX_MB * 1024 * 1024).filter(isAccepted);
    setFiles(prev => [...prev, ...valid.map(f => ({ file: f, docType: 'other', id: Math.random().toString(36).slice(2) }))]);
  };

  const handleQueue = async () => {
    if (files.length === 0) return;
    setIsUploading(true);
    setError(null);

    try {
      // ── 1. Parallel upload with auto-retry (2 extra attempts) ──
      setStatusText('מעלה מסמכים');
      const uploadWithRetry = async (file, docType, maxAttempts = 3) => {
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const file_url = await uploadFileToStorage(file);
            return { file_url, document_type: docType, file_name: file.name };
          } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
              console.warn(`Upload attempt ${attempt} failed for ${file.name}, retrying...`);
              await new Promise(r => setTimeout(r, 1500 * attempt));
            }
          }
        }
        throw new Error(`העלאת הקובץ "${file.name}" נכשלה לאחר ${maxAttempts} ניסיונות: ${lastErr?.message || ''}`);
      };

      const uploaded = await Promise.all(
        files.map(({ file, docType }) => uploadWithRetry(file, docType))
      );

      // ── Validation: don't continue if not even one file uploaded ──
      if (!uploaded || uploaded.length === 0) {
        setError('העלאת המסמך נכשלה — לא התקבלו קבצים. נסה שוב.');
        setIsUploading(false);
        return;
      }

      // ── 1.5. CLIENT-SIDE CHUNKING — splits a large PDF into 7-page chunks in the browser ──
      // The browser (no 150s limit) does the heavy work, so each chunk is sent for extraction separately.
      setStatusText('מפצל מסמכים גדולים');
      const flatUrls = await expandLargePdfs(uploaded);

      // ── 1.7. TRUE FRONTEND ORCHESTRATION — parallel extraction in the browser against the Pro model ──
      // Instead of the cloud Worker running the LLM loop (and hitting a 150s Timeout), the browser
      // runs Promise.all against extractSingleChunk — one call per chunk, each on gemini Pro.
      // The browser has no Timeout limit, so Pro (the smart one) can fully analyze land registry
      // extracts and complex mortgages.
      setStatusText(`מחלץ נתונים מ-${flatUrls.length} מסמכים (מודל Pro)`);
      // ── AbortSignal 150s — guards against a zombie spinner client-side ──
      const CLIENT_TIMEOUT_MS = 150_000;
      const extractedResults = await Promise.all(
        flatUrls.map(async (u) => {
          const controller = new AbortController();
          const killTimer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
          try {
            const { data, error: invokeError } = await supabase.functions.invoke('extractSingleChunk', { body: { file_url: u.file_url } });
            clearTimeout(killTimer);
            if (invokeError) return { _failed: true, error: invokeError.message || 'no data' };
            return data || { _failed: true, error: 'no data' };
          } catch (err) {
            clearTimeout(killTimer);
            if (err?.name === 'AbortError' || controller.signal.aborted) {
              return { _failed: true, error: 'הניתוח ארך זמן רב מדי, אנא נסה שוב' };
            }
            return { _failed: true, error: err?.message || 'chunk failed' };
          }
        })
      );

      // ── Validation before creating a case — prevents a "zombie case" ──
      const successfulExtractions = extractedResults.filter(r => !r?._failed);
      if (successfulExtractions.length === 0) {
        setError('חילוץ הנתונים מהמסמכים נכשל — נסה להעלות שוב. אם הבעיה חוזרת, בדוק שהקובץ קריא ולא מוצפן.');
        setIsUploading(false);
        return;
      }

      // ── Merge deal context from Deal Setup into wizardData + deal_context ──
      const mergedWizardData = { ...(wizardData || {}), ...(dealSetup?.wizardData || {}) };
      const dealContext = dealSetup?.dealContext || null;

      // ── 2. Create the processing record immediately ──
      setStatusText('יוצר תיק בתור העיבוד');
      const { data: newCase, error: createError } = await supabase.from('mortgage_cases').insert({
        case_number: `UW-${Date.now().toString().slice(-6)}`,
        primary_borrower: { full_name: 'בעיבוד...', id_number: '' },
        case_type: mergedWizardData.caseType || 'mortgage',
        case_status: 'processing',
        score_data: {
          _processing: {
            status: 'processing',
            queued_at: new Date().toISOString(),
            file_count: flatUrls.length,
            fileUrls: flatUrls,
            extractedResults,
            wizardData: mergedWizardData,
            dealContext
          }
        }
      }).select().single();
      if (createError) throw createError;

      // ── 3. Detached invoke (no await) — the Worker only merges and builds the report (no LLM) ──
      supabase.functions.invoke('processUnderwriterCase', {
        body: {
          caseId: newCase.id,
          extractedResults,
          fileUrls: flatUrls,
          wizardData: mergedWizardData,
          deal_context: dealContext
        }
      }).catch(() => { /* fire-and-forget — the sweeper will catch it if it fails */ });

      toast.success('הקובץ התקבל — מתעבד ברקע', {
        description: `${uploaded.length} מסמכים בעיבוד. תקבל התראה כשהדוח מוכן.`,
        duration: 5000
      });

      // ── 4. Release the UI immediately ──
      onQueued(newCase.id);

    } catch (err) {
      setError(err?.message || 'שגיאה בהעלאה');
      setIsUploading(false);
    }
  };

  // ── Step 1: open a case — deal context before uploading documents ──
  if (!dealSetup) {
    return (
      <DealSetupModal
        initialCaseType={wizardData?.caseType}
        onConfirm={(setup) => {
          scrollYBeforeDealSetup.current = window.scrollY;
          setDealSetup(setup);
        }}
        onBack={onBack}
      />
    );
  }

  if (isUploading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-6">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border border-[#C5A059]/30 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-[#C5A059] animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-white font-medium">{statusText}</p>
          <p className="text-[#8892B0] text-xs mt-1">{files.length} מסמכים — שחרור מיידי תוך שניות</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <button onClick={() => setDealSetup(null)} className="text-[#8892B0] hover:text-[#C5A059] text-sm flex items-center gap-1.5 transition-colors">
          <ChevronRight className="w-4 h-4" />
          ערוך פרטי עסקה
        </button>
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-4 py-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400 text-xs font-bold tracking-widest">עיבוד אסינכרוני</span>
        </div>
        <div className="w-20" />
      </div>

      {/* ── Summary of the selected deal context ── */}
      {dealSetup?.dealContext && (
        <div className="flex flex-wrap items-center gap-2 bg-[#0d1524] border border-[#C5A059]/20 rounded-xl px-4 py-3">
          <span className="text-[#C5A059] text-xs font-bold tracking-wider">
            {dealSetup.dealContext.loan_purpose === 'refinance' ? 'מחזור ואיחוד'
              : dealSetup.dealContext.loan_purpose === 'any_purpose' ? 'הלוואה לכל מטרה'
              : 'רכישת נכס'}
          </span>
          <span className="text-[#2a3a55]">·</span>
          <span className="text-[#8892B0] text-xs">שווי נכס: <span className="text-white font-mono">₪{(dealSetup.dealContext.estimated_property_value || 0).toLocaleString('he-IL')}</span></span>
          <span className="text-[#2a3a55]">·</span>
          <span className="text-[#8892B0] text-xs">מבוקש: <span className="text-white font-mono">₪{(dealSetup.dealContext.requested_mortgage_amount || 0).toLocaleString('he-IL')}</span></span>
          {dealSetup.dealContext.ltv_projected != null && (
            <>
              <span className="text-[#2a3a55]">·</span>
              <span className="text-[#8892B0] text-xs">LTV: <span className="text-[#C5A059] font-mono font-bold">{dealSetup.dealContext.ltv_projected}%</span></span>
            </>
          )}
        </div>
      )}

      <div className="bg-[#C5A059]/5 border border-[#C5A059]/25 rounded-xl p-4 text-center">
        <p className="text-[#8892B0] text-sm">
          העלה קלסר מסמכים עבה (גם 30-70 עמודים) — העיבוד הכבד מתבצע ברקע.<br/>
          <span className="text-[#C5A059]">תוכל להמשיך לעבוד מיד ותקבל התראה כשהדוח מוכן.</span>
        </p>
      </div>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-[#1e2d4a] hover:border-[#C5A059]/40 rounded-2xl p-10 text-center cursor-pointer transition-all bg-[#0d1524]"
      >
        <Upload className="w-10 h-10 text-[#C5A059]/50 mx-auto mb-3" />
        <p className="text-white font-medium">גרור קבצים לכאן או לחץ לבחירה</p>
        <p className="text-[#8892B0] text-sm mt-1">PDF, תמונות (JPG, PNG, HEIC) — עד 50MB</p>
        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.tiff,.bmp,image/*,application/pdf" multiple className="hidden" onChange={e => addFiles(Array.from(e.target.files))} />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(({ file, docType, id }) => (
            <div key={id} className="flex items-center gap-3 bg-[#0d1524] border border-[#1e2d4a] rounded-xl px-4 py-3">
              {file.type?.startsWith('image/') ? <Image className="w-4 h-4 text-[#C5A059] shrink-0" /> : <FileText className="w-4 h-4 text-[#C5A059] shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{file.name}</p>
                <p className="text-[#4a5568] text-xs">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <select
                value={docType}
                onChange={e => setFiles(prev => prev.map(f => f.id === id ? { ...f, docType: e.target.value } : f))}
                className="bg-[#111827] border border-[#1e2d4a] text-[#8892B0] text-xs rounded-lg px-2 py-1.5 outline-none"
              >
                {DOC_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
              </select>
              <button onClick={() => setFiles(prev => prev.filter(f => f.id !== id))} className="text-[#4a5568] hover:text-red-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      <button
        onClick={handleQueue}
        disabled={files.length === 0}
        className="w-full py-4 bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-40 text-[#0A0F1A] font-bold text-sm rounded-xl transition-all"
      >
        שלח לעיבוד ברקע — {files.length} {files.length === 1 ? 'קובץ' : 'קבצים'}
      </button>
    </div>
  );
}
