import React, { useState, useRef, useEffect } from 'react';
import { supabase, uploadFileToStorage, parseInvokeError } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, Loader2, Zap, X, CheckCircle2, AlertTriangle, XCircle, TrendingUp, Download, Star, ArrowLeft, ScanSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import QuickCheckReport from '@/components/quickcheck/QuickCheckReport';
import PreScanResult from '@/components/quickcheck/PreScanResult';
import IntakeQuestionsPanel from '@/components/quickcheck/IntakeQuestionsPanel';
import ErrorMessage from '@/components/quickcheck/ErrorMessage';
import { minifyPartialResults } from '@/components/lib/minifyExtractedData';
import { expandLargePdfs } from '@/components/lib/pdfPageSplitter';
import { mergeExtractedDocuments } from '../../shared/mergeExtractedDocuments.js';
import { reconcileIdentityFromPreScan } from '../../shared/reconcileIdentityFromPreScan.js';

export default function QuickDocCheck() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [errorState, setErrorState] = useState(null); // { text, code } — מוצג כש-API נדחה (במקום קריסת null)
  const [reportType, setReportType] = useState('זיהוי אוטומטי');
  const [uploadedFileUrls, setUploadedFileUrls] = useState([]);
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [manualPropertyValue, setManualPropertyValue] = useState('');
  const [proposedMortgagePayment, setProposedMortgagePayment] = useState('');
  const [preScanResult, setPreScanResult] = useState(null);
  const [isPreScanning, setIsPreScanning] = useState(false);
  const [uploadedUrlsForScan, setUploadedUrlsForScan] = useState([]);
  const [intakeQuestions, setIntakeQuestions] = useState(null);
  const [intakeDiagnosis, setIntakeDiagnosis] = useState(null);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  // 'quick' | 'full' — which result tab is showing. Only relevant once at least one
  // of preScanResult/result exists; see the tab bar in the render below.
  const [activeResultTab, setActiveResultTab] = useState('quick');
  // useRef כדי שהנתונים יהיו זמינים מיד בסבב השני (setState הוא async)
  const cachedExtractedDataRef = useRef(null);

  // ── ניקוי זיכרון בכניסה לעמוד — מניעת ערבוב נתונים בין לקוחות ──
  useEffect(() => {
    setFiles([]);
    setResult(null);
    setErrorState(null);
    setPreScanResult(null);
    setProgress(0);
    setUploadedFileUrls([]);
    setUploadedUrlsForScan([]);
    setAdditionalAmount('');
    setManualPropertyValue('');
    setProposedMortgagePayment('');
    setIntakeQuestions(null);
    setIntakeDiagnosis(null);
    setActiveResultTab('quick');
    cachedExtractedDataRef.current = null;
  }, []);

  // The full report is the more actionable view, so once it's ready switch to it
  // automatically — but preScanResult stays available on its own tab, not discarded.
  useEffect(() => {
    if (result) setActiveResultTab('full');
  }, [result]);

  // דחיסת תמונות לפני העלאה — 2000px מקסימום, 80% quality
  const compressImage = (file) => {
    return new Promise((resolve) => {
      // רק תמונות — PDF עובר כמו שהוא
      if (!file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_DIM = 2000;
        let { width, height } = img;
        // אם התמונה קטנה מ-2000px — לא צריך דחיסה
        if (width <= MAX_DIM && height <= MAX_DIM && file.size < 1.5 * 1024 * 1024) {
          resolve(file);
          return;
        }
        // חישוב יחס
        if (width > height) {
          if (width > MAX_DIM) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
        } else {
          if (height > MAX_DIM) { width = Math.round(width * MAX_DIM / height); height = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          const compressed = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        }, 'image/jpeg', 0.80);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  const handleFileUpload = (e) => {
    const newFiles = Array.from(e.target.files);
    if (newFiles.length === 0) return;
    setFiles(prev => [...prev, ...newFiles]);
    setResult(null);
    setErrorState(null);
    setPreScanResult(null);
    setUploadedUrlsForScan([]);
    toast.success(`נוספו ${newFiles.length} קבצים`);
    e.target.value = '';
  };

  const runPreScan = async () => {
    if (files.length === 0) {
      toast.error('נא להעלות קבצים תחילה');
      return;
    }
    setIsPreScanning(true);
    try {
      // Upload files — עם דחיסת תמונות
      let urls = uploadedUrlsForScan;
      if (urls.length === 0) {
        toast.loading(`📦 דוחס ומעלה ${files.length} קבצים...`);
        const compressedFiles = await Promise.all(files.map(compressImage));
        const uploadResults = await Promise.all(
          compressedFiles.map(async (file) => {
            const url = await uploadFileToStorage(file);
            return { url, name: file.name, type: file.type };
          })
        );
        toast.dismiss();
        setUploadedUrlsForScan(uploadResults);
        setUploadedFileUrls(uploadResults);
        urls = uploadResults;
      }

      toast.loading('סורק מסמכים... (עשוי לקחת עד דקה)');
      // supabase.functions.invoke resolves to { data: null, error } on any non-2xx response
      // (preScanDocuments returns 400/500 on real failures) — not a thrown axios-style rejection,
      // so retry logic branches on `error` here rather than a try/catch around the call.
      const callPreScan = () => supabase.functions.invoke('preScanDocuments', {
        body: { file_urls: urls.map(f => f.url) }
      });
      let { data, error } = await callPreScan();
      if (error) {
        // retry אחד אוטומטי — רק אם לא שגיאת קובץ פגום
        const errBody = await parseInvokeError(error);
        const errMsg = errBody?.error || error.message || '';
        if (errBody?.error_code === 'FILE_CORRUPTED' || errMsg.includes('פגום') || errMsg.includes('ריק') || errMsg.includes('FILE_CORRUPTED')) {
          throw new Error(errMsg || 'סריקה נכשלה — קובץ פגום');
        }
        toast.dismiss();
        toast.loading('🔄 ניסיון נוסף... (תיק גדול)');
        ({ data, error } = await callPreScan());
        if (error) {
          const retryErrBody = await parseInvokeError(error);
          throw new Error(retryErrBody?.error || error.message || 'הסריקה נכשלה');
        }
      }
      toast.dismiss();

      if (data.error) throw new Error(data.error);
      setPreScanResult(data);
      toast.success('✅ סריקה הושלמה!');
    } catch (error) {
      toast.dismiss();
      toast.error('⏱️ הסריקה נכשלה — נסה שוב או עבור ישר ל"הפק דוח מלא"', { duration: 6000 });
    } finally {
      setIsPreScanning(false);
    }
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setUploadedUrlsForScan([]);
  };

  // נקרא אחרי חילוץ הנתונים — מייצר שאלות ממוקדות
  // מחזיר true אם יש שאלות (צריך לעצור ולחכות), false אם אין (ממשיכים לדוח)
  // DEFERRED: generateIntakeQuestions was never ported to Supabase, and this wrapper is
  // dead code anyway — nothing in the real flow calls generateQuestionsAndCheck. Left
  // inert (no base44/supabase call) rather than wired up. See task memory:
  // "generateIntakeQuestions ... dead code path already ... don't waste time on it."
  const generateQuestionsAndCheck = async (_extractedData, _activeReportType) => {
    return false; // אין שאלות — המשך לדוח
  };

  const runQuickCheck = async (overrideReportType, intakeAnswers = null) => {
    if (files.length === 0) {
      toast.error('נא להעלות קבצים תחילה');
      return;
    }

    // Guard: ensure overrideReportType is a plain string, not a DOM event
    const activeReportType = (typeof overrideReportType === 'string' ? overrideReportType : null) || reportType;

    setIsChecking(true);
    setProgress(10);
    setErrorState(null); // ניקוי שגיאה קודמת לפני ניתוח חדש

    try {
      // העלאת כל הקבצים — עם דחיסת תמונות לפני שליחה
      let uploadedUrls = uploadedUrlsForScan;
      if (uploadedUrls.length === 0) {
        toast.loading(`📦 דוחס ומעלה ${files.length} קבצים...`);
        setProgress(8);
        // שלב 1: דחיסת תמונות במקביל
        const compressedFiles = await Promise.all(files.map(compressImage));
        setProgress(15);
        // שלב 2: העלאה במקביל
        const uploadResults = await Promise.all(
          compressedFiles.map(async (file) => {
            const url = await uploadFileToStorage(file);
            return { url, name: file.name, type: file.type };
          })
        );
        toast.dismiss();
        uploadedUrls = uploadResults;
        setUploadedUrlsForScan(uploadedUrls);
        setUploadedFileUrls(uploadedUrls);
      }
      setProgress(25);

      const isRefinancePlus = activeReportType === 'מחזור משכנתא + תוספת הון';
      const additionalAmountNum = isRefinancePlus ? (parseInt(String(additionalAmount).replace(/,/g, '')) || 0) : 0;

      // אם יש נתונים שמורים מסבב קודם (ref — זמין מיד, לא async) — דלג על החילוץ
      let extractedData;
      if (cachedExtractedDataRef.current && intakeAnswers !== null) {
        // סבב שני — יש תשובות ויש נתונים שמורים ב-ref
        extractedData = cachedExtractedDataRef.current;
        setProgress(55);
      } else {
      // ── PDF PAGE SPLITTER — מפצל קבצים גדולים (>15 עמודים) לצ'אנקים בדפדפן ──
      // קובץ 34 עמודים (7MB) נשלח ב-3 צ'אנקים של 15 עמודים — כל צ'אנק מסתיים ב-<30 שניות.
      // בלי פיצול → 504 Gateway Timeout מובטח על קבצים גדולים.
      toast.loading('📄 בודק ומפצל קבצים גדולים...');
      let expandedFiles = uploadedUrls.map(f => ({ file_url: f.url, document_type: 'other', file_name: f.name || '' }));
      try {
        expandedFiles = await expandLargePdfs(expandedFiles, (name, chunks) => {
          toast.dismiss();
          toast.loading(`✂️ פיצל "${name}" ל-${chunks} חלקים...`);
        });
      } catch (splitErr) {
        console.warn('PDF splitting skipped — using original files:', splitErr?.message);
      }
      toast.dismiss();
      const allUrls = expandedFiles.map(f => f.file_url);

      // ── safeInvoke: עטיפה אטומה ל-Hard Crash. זורק מיד אם השרת מת (Network/500/data חסר),
      // כך ששום קוד למטה לא ייגע ב-.borrowers על אובייקט null. זו ה"הרג רינדור באותו רגע".
      const safeInvoke = async (batch, label) => {
        try {
          // ── ALWAYS THOROUGH — same extraction engine + cache as the Underwriter flow ──
          // Quick Check used to call extractDocData's lighter, faster "Fast Lane" schema,
          // which meant the exact same document could be extracted twice at two different
          // quality levels if the prospect later converted to a full case (the files carry
          // forward unchanged via transferToFullProcess). extractSingleChunk is the richer,
          // battle-tested extraction engine and is cache-backed by file_url (DocumentExtractionCache):
          // the first upload pays the full cost once; every later flow that touches the same
          // physical file (including this prospect's own eventual real case) reuses the result.
          // supabase.functions.invoke resolves { data, error } — it does NOT throw on non-2xx,
          // and (unlike the old Base44/axios SDK) there is no r.status to check. extractSingleChunk
          // always returns HTTP 200 (even on extraction failure, via { error, _failed: true }), so a
          // populated `error` here means a real network/relay failure, not an extraction failure.
          const { data, error } = await supabase.functions.invoke('extractSingleChunk', { body: { file_url: batch[0] } });
          if (error) {
            const errBody = await parseInvokeError(error);
            const e = new Error(errBody?.error || error.message || `🛑 השרת קרס — חילוץ ${label} נכשל`);
            e.errorCode = errBody?.error_code || 'SERVER_CRASH';
            throw e;
          }
          // ── ROOT-CAUSE FIX: typeof null === 'object' עבר את הבדיקה הישנה! ──
          // כש-500 תשתיתי מחזיר גוף עם data:null, הבדיקה הקודמת אישרה אותו (כי typeof null==='object'),
          // והקוד למטה ניגש ל-data.borrowers על null → "Cannot read properties of null (reading 'borrowers')".
          // עכשיו חוסמים במפורש null + מוודאים ש-borrowers הוא מערך לפני שמחזירים.
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            const e = new Error(`🛑 השרת קרס — חילוץ ${label} נכשל`);
            e.errorCode = 'SERVER_CRASH';
            throw e;
          }
          // extractSingleChunk returns status 200 even on extraction failures — check body.
          // Its failure convention is { error, _failed: true } (not extractDocData's error_code).
          if (data._failed && !data.borrowers?.length && !data.payslips_borrower1?.length && !data.loans?.length) {
            const e = new Error(data.error || `לא ניתן לחלץ נתונים מהמסמכים שהועלו.`);
            e.errorCode = 'EXTRACTION_FAILED';
            throw e;
          }
          return data;
        } catch (invokeErr) {
          const msg = invokeErr?.message || '';
          const is504 = invokeErr?.status === 504 || msg.includes('504') || msg.includes('Gateway');
          const e = new Error(is504 ? '⏱️ זמן קצוב חרג (504) — הקובץ גדול מדי. מנסה לפצל ולשלוח מחדש.' : (msg || `🛑 השרת קרס — חילוץ ${label} נכשל`));
          e.errorCode = is504 ? 'TIMEOUT' : (invokeErr?.errorCode || 'SERVER_CRASH');
          throw e;
        }
      };

      // ── ROOT-CAUSE FIX: חילוץ קובץ-אחר-קובץ (מונע 500 תשתיתי / Timeout / OOM) ──
      // שליחת כל הקבצים בבקשה אחת חצתה את רף ה-Timeout/RAM של התשתית, שהרגה את ה-Process
      // והחזירה 500 גולמי עם גוף null → קריסת ".borrowers על null". עכשיו: כל קובץ נשלח
      // בבקשה נפרדת וקצרה. ממזגים את התוצאות כאן (ר' mergeExtractedDocuments המשותף). אם
      // קובץ בודד נכשל — ממשיכים לשאר (לא מפילים את כל הניתוח). כל בקשה קלה → התשתית לעולם לא קורסת.

      // ── TRUE PARALLELISM (Rollback ל"דקה וחצי") ──
      // מבטלים את ה-BATCH_SIZE=3 הסדרתי ששהה קבוצות. כל הקבצים נשלחים בבת אחת ב-Promise.all.
      // כל קובץ = בקשה נפרדת ל-extractSingleChunk (cache-aware), כך שאין Timeout/OOM תשתיתי גם ב-11 קבצים.
      // הזמן הכולל = זמן העיבוד של הקובץ האיטי ביותר בלבד, ופחות מזה עבור קבצים שכבר במטמון.
      let okCount = 0;
      let lastErr = null;
      const partialResults = []; // ה-JSONים החלקיים הגולמיים — חומר הגלם לשלב ה-Gather
      const successfulResults = []; // תוצאות מוצלחות בלבד — קלט ל-mergeExtractedDocuments
      // ── PARALLEL EXECUTION — כל הקבצים בו-זמנית ──
      // כל קובץ = בקשה נפרדת ל-extractSingleChunk (cache-aware, thorough extraction).
      // זמן כולל = זמן הקובץ האיטי ביותר בלבד (לא סכום כל הקבצים).
      toast.loading(`🔍 מנתח ${allUrls.length} קבצים במקביל...`);
      const parallelResults = await Promise.allSettled(
        allUrls.map((url, idx) => safeInvoke([url], `קובץ ${idx + 1}`))
      );
      for (const res of parallelResults) {
        if (res.status === 'fulfilled') {
          successfulResults.push(res.value);
          partialResults.push(res.value);
          okCount++;
        } else {
          console.warn(`קובץ נכשל בחילוץ — ממשיכים:`, res.reason?.message);
          lastErr = res.reason;
        }
      }
      const merged = mergeExtractedDocuments(successfulResults) || { borrowers: [], payslips_borrower1: [], payslips_borrower2: [] };
      setProgress(50);
      toast.dismiss();
      // אם אף קובץ לא הצליח — זורקים שגיאה מסודרת (תוצג כ-ErrorMessage, לא קריסה)
      if (okCount === 0) {
        const e = new Error(lastErr?.message || '🛑 לא ניתן היה לחלץ נתונים מאף אחד מהקבצים. נסה קבצים אחרים או באיכות גבוהה יותר.');
        e.errorCode = lastErr?.errorCode || 'ALL_FILES_FAILED';
        throw e;
      }
      extractedData = {
        ...merged,
        borrowers: merged.borrowers || [],
        payslips_borrower1: merged.payslips_borrower1 || [],
        payslips_borrower2: merged.payslips_borrower2 || [],
      };

      // ── שלב GATHER / REDUCE (Map-Reduce) — תיקון "דוח פרנקנשטיין" ──
      // המיזוג הדטרמיניסטי למעלה מהיר אך "טיפש": הוא לא יודע לשייך מכתב רו"ח לאדם הנכון,
      // לחבר בין בעל לאישה, או לזהות שת"ז שהופיעה בקובץ אחד תקפה לכל התיק. לכן שולחים את כל
      // ה-JSONים החלקיים (טקסט בלבד — מהיר, ללא OOM) לקריאה מסכמת אחת ל-Gemini שבונה פרופיל
      // לקוח אחד מאוחד ומדויק. אם השלב הזה נכשל מסיבה כלשהי — נשארים עם המיזוג הדטרמיניסטי (fallback בטוח).
      if (partialResults.length >= 2) {
        try {
          toast.loading('🧩 מאחד את נתוני התיק לפרופיל לקוח אחד מדויק...');
          // ── PAYLOAD MINIMIZATION (דיאטה לנתונים) — מונע Networking Error / Timeout ──
          // לפני שליחה ל-Gather מכווצים כל JSON חלקי: מוחקים שדות כבדים (raw_text, page_numbers)
          // ומערכים/אובייקטים ריקים. כך ה-Payload יורד דרמטית וה-InvokeLLM מסיים לפני רף ה-Gateway.
          const minifiedPartials = minifyPartialResults(partialResults);
          const { data: consolidateData, error: consolidateError } = await supabase.functions.invoke('consolidateExtractedData', {
            body: { partialResults: minifiedPartials, reportType: activeReportType }
          });
          toast.dismiss();
          if (consolidateError) throw consolidateError; // caught below — non-critical, falls back to deterministic merge
          const c = consolidateData?.consolidated;
          if (c && typeof c === 'object' && Array.isArray(c.borrowers) && c.borrowers.length > 0) {
            // הפרופיל המאוחד גובר — אך שומרים על מערכי הליבה שנאספו אם ה-AI החזיר ריקים
            extractedData = {
              ...extractedData,
              ...c,
              payslips_borrower1: (c.payslips_borrower1?.length ? c.payslips_borrower1 : extractedData.payslips_borrower1) || [],
              payslips_borrower2: (c.payslips_borrower2?.length ? c.payslips_borrower2 : extractedData.payslips_borrower2) || [],
              borrowers: c.borrowers,
            };
          }
        } catch (consolidateErr) {
          toast.dismiss();
          console.warn('Consolidation skipped (non-critical) — using deterministic merge:', consolidateErr?.message);
        }
      }
      } // end else (no cached extractedData)

      setProgress(55);

      // ── אטימה סופית: לפני כל עיבוד נוסף (normalize/buildQuickReport) — מוודאים ש-extractedData
      // הוא אובייקט עם מערך borrowers תקין. אם השרת קרס (500) ו-extractedData null/שבור —
      // עוצרים כאן ב-Early Return מוחלט, כך ששום פונקציה למטה לא תיגע ב-null.borrowers. ←
      if (!extractedData || typeof extractedData !== 'object' || !Array.isArray(extractedData.borrowers)) {
        const e = new Error('🛑 השרת קרס בעת חילוץ הנתונים — לא הוחזר מבנה תקין. נסה שוב, או העלה פחות מסמכים בכל פעם.');
        e.errorCode = 'SERVER_CRASH';
        throw e;
      }

      // שלב ביניים: דילוג על שאלות — ממשיכים ישירות לדוח
      if (intakeAnswers === null) {
        cachedExtractedDataRef.current = extractedData;
        intakeAnswers = {};
      }

      // אם הגיעו תשובות — השתמש ב-extractedData הקיים מהסבב הראשון (חוסך חילוץ מחדש)
      // NULL GUARD: אם החילוץ נכשל/ה-ref ריק — extractedData עלול להיות null. עוצרים כאן במקום לקרוס על rawData.borrowers
      if (!extractedData || typeof extractedData !== 'object') {
        const e = new Error('חילוץ הנתונים לא הסתיים — נסה להעלות את המסמכים מחדש');
        e.errorCode = 'NO_EXTRACTED_DATA';
        throw e;
      }
      // ── IDENTITY RECONCILIATION FROM PRE-SCAN ──
      // preScanDocuments sees all files together in one call with an identity-only schema, and
      // is measurably better at correctly identifying both borrowers than extractSingleChunk's
      // per-file calls (larger schema, no cross-file context). If the user ran סרוק מה יש בתיק
      // first, use its findings to fill gaps in the extraction's own borrowers array — never
      // overwrites data extraction already has, only fills empty fields or adds a borrower
      // extraction missed entirely. See shared/reconcileIdentityFromPreScan.js.
      const rawData = reconcileIdentityFromPreScan(extractedData, preScanResult);
      const cleanedRawData = {
        borrowers: Array.isArray(rawData.borrowers) ? rawData.borrowers : [],
        payslips_borrower1: rawData.payslips_borrower1,
        payslips_borrower2: rawData.payslips_borrower2,
        payslips: rawData.payslips,
        payslip_deductions: rawData.payslip_deductions,
        payslip_deduction_alerts: rawData.payslip_deduction_alerts,
        payslip_employer_changes: rawData.payslip_employer_changes,
        pension_slips: rawData.pension_slips,
        income_deposits: rawData.income_deposits,
        keren_hishtalmut: rawData.keren_hishtalmut,
        pension_funds: rawData.pension_funds,
        existing_mortgage: rawData.existing_mortgage,
        all_mortgages: rawData.all_mortgages,
        loans: rawData.loans,
        credit_cards: rawData.credit_cards,
        business_data: rawData.business_data,
        disability_info: rawData.disability_info,
        property_value: rawData.property_value,
        property_purpose: rawData.property_purpose,
        requested_loan_amount: rawData.requested_loan_amount,
        requested_loan_years: rawData.requested_loan_years,
        alimony_monthly: rawData.alimony_monthly,
        bank_red_flags: rawData.bank_red_flags,
        bdi_red_flags: rawData.bdi_red_flags,
        aml_red_flags: rawData.aml_red_flags,
        undisclosed_loan_indicators: rawData.undisclosed_loan_indicators,
        special_circumstances: rawData.special_circumstances,
        detected_case_types: rawData.detected_case_types,
        equity_events: rawData.equity_events,
        total_equity_evidence: rawData.total_equity_evidence,
        actionable_recommendations: rawData.actionable_recommendations,
        cash_flow_summary: rawData.cash_flow_summary,
        reserve_duty_months: rawData.reserve_duty_months,
        tabu_data: rawData.tabu_data,
        purchase_contract_value: rawData.purchase_contract_value,
      };

      // שלב 2: נרמול דטרמיניסטי — ניקוי פלט ה-AI לפני חישובים
      // normalizeDocData returns 400/500 on real failures (non-2xx) — supabase.functions.invoke
      // surfaces that as { data: null, error }, not a thrown axios-style rejection with .status.
      const { data: normalizedData0, error: normalizeError } = await supabase.functions.invoke('normalizeDocData', {
        body: { rawData: cleanedRawData, reportType: activeReportType }
      });
      if (normalizeError) {
        const errBody = await parseInvokeError(normalizeError);
        throw new Error('שגיאה בנרמול: ' + (errBody?.error || normalizeError.message || 'תגובת שרת שגויה'));
      }
      if (!normalizedData0 || normalizedData0.error) {
        throw new Error('שגיאה בנרמול: ' + (normalizedData0?.error || 'תגובת שרת שגויה'));
      }
      let normalizedRawData = normalizedData0;

      // שלב 2.5: Shadow Debt Engine — זיהוי חובות נסתרים (Circuit Breaker: לעולם לא קורס, תמיד מחזיר 200)
      try {
        setProgress(62);
        const { data: shadowData, error: shadowError } = await supabase.functions.invoke('shadowDebtEngine', {
          body: { normalizedData: normalizedRawData }
        });
        if (shadowError) throw shadowError;
        if (shadowData && !shadowData._shadow_debt?._engine_failed) {
          normalizedRawData = shadowData;
        }
      } catch (shadowErr) {
        console.warn('shadowDebtEngine skipped (non-critical):', shadowErr.message);
      }

      // שלב 2.7: מנוע רילוקיישן + הייטק — מאחד מעסיק גלובלי, ESPP מ-note, אימות שם דו-לשוני
      try {
        const { data: relocData, error: relocError } = await supabase.functions.invoke('hitechRelocationEngine', {
          body: { rawData: normalizedRawData }
        });
        if (relocError) throw relocError;
        if (relocData && !relocData.error) {
          normalizedRawData = relocData;
        }
      } catch (relocErr) {
        console.warn('hitechRelocationEngine skipped (non-critical):', relocErr.message);
      }

      // שלב 3: חישובים + מכתב לבנק
      // buildQuickReport's fatal catch always returns 400 (see index.ts) — a real failure here
      // is a non-2xx response, i.e. supabase gives us { data: null, error }, not thrown data.
      const { data: reportData, error: reportError } = await supabase.functions.invoke('buildQuickReport', {
        body: {
          rawData: normalizedRawData,
          reportType: activeReportType,
          additionalAmountNum: additionalAmountNum,
          manualPropertyValue: manualPropertyValue ? parseInt(String(manualPropertyValue).replace(/,/g, '')) || 0 : 0,
          proposedMortgagePayment: proposedMortgagePayment ? parseInt(String(proposedMortgagePayment).replace(/,/g, '')) || 0 : 0,
          intakeAnswers: intakeAnswers || {},
        }
      });

      if (reportError) {
        const errBody = await parseInvokeError(reportError);
        throw new Error(errBody?.error || reportError.message || 'בניית הדוח נכשלה — תגובת שרת שגויה');
      }
      if (!reportData || reportData.error) {
        throw new Error(reportData?.error || 'בניית הדוח נכשלה — תגובת שרת שגויה');
      }

      const analysis = reportData;
      setProgress(100);

      // ── בדיקת שלמות נתונים קריטיים — אם אין שם/ת.ז/הכנסה → הצג אזהרה מפורשת ←
      const missingCritical = [];
      const b1Name = analysis.borrower_info?.name;
      const b1Id = analysis.borrower_info?.id;
      const income = analysis.borrower_info?.total_household_income || analysis.borrower_info?.avg_income || 0;
      if (!b1Name || b1Name === 'לא זוהה' || b1Name === 'N/A') missingCritical.push('שם לווה — לא נמצא בשום מסמך');
      if (!b1Id || (b1Id + '').replace(/\D/g, '').length !== 9) missingCritical.push('תעודת זהות — לא נמצאה (9 ספרות)');
      if (income === 0) missingCritical.push('הכנסה — לא נמצאו תלושי שכר / שומות מס / מכתב רו"ח');
      if (missingCritical.length > 0) {
        const docTypes = files.map(f => f.name).join(', ');
        toast.error(`⚠️ נתונים קריטיים חסרים — הדוח לא יהיה שלם. חסר: ${missingCritical.join(' | ')}`, { duration: 8000 });
        console.warn('Missing critical data:', missingCritical, 'Files uploaded:', docTypes);
      }

      // המכתב לבנק מגיע ישירות מ-buildQuickReport (דטרמיניסטי, ללא AI נוסף)
      const enrichedResult = { ...analysis, filesCount: files.length, reportType: activeReportType, _missingCritical: missingCritical };
      if (isRefinancePlus && additionalAmountNum > 0) {
        enrichedResult.additional_equity_requested = additionalAmountNum;
        // loan_requested = יתרה קיימת + תוספת
        if (enrichedResult.existing_mortgage?.remaining_balance) {
          enrichedResult._computed_total_loan = enrichedResult.existing_mortgage.remaining_balance + additionalAmountNum;
        }
      }
      setResult(enrichedResult);
      toast.success('✅ ניתוח הושלם בהצלחה!');

    } catch (error) {
      console.error('Error:', error);
      // ── שומר הסף: שלוף את ההודעה האמיתית מגוף תגובת השרת (axios קובר אותה ב-response.data.error) ──
      const errMsg = error?.response?.data?.error || error?.message || 'שגיאה לא ידועה';
      const errCode = error?.response?.data?.error_code || error?.errorCode || '';
      let display = errMsg;
      if (errCode === 'EXTRACTION_FAILED' || errMsg.includes('לא ניתן לחלץ')) {
        display = '⚠️ ' + errMsg;
      } else if (errCode === 'ALL_FILES_FAILED' || errMsg.includes('כל הקבצים נכשלו')) {
        display = '❌ כל הקבצים נכשלו בקריאה — ייתכן שמדובר ב-PDF סרוק פגום, ריק או מוגן בסיסמה. פתח כל קובץ ידנית, ודא שהוא תקין, והעלה מחדש.';
      } else if (errCode === 'FILE_CORRUPTED' || errMsg.includes('פגום') || errMsg.includes('ריק')) {
        display = '⚠️ אחד הקבצים פגום או ריק (אין עמודים). יש לפתוח אותו ולהעלות מחדש.';
      } else if (errCode === 'FILE_TOO_LARGE' || errMsg.includes('גדול מדי')) {
        display = '📦 קובץ גדול מדי — פצל ל-PDF של עד 10MB והעלה שוב.';
      } else if (errCode === 'TIMEOUT' || errMsg.includes('זמן') || errMsg.includes('504') || errMsg.includes('504')) {
        display = '⏱️ הניתוח לקח יותר מדי זמן (504) — הקובץ גדול מדי. ודא שהקובץ עד 30 עמודים ונסה שוב.';
      } else if (errCode === 'RATE_LIMIT' || errMsg.includes('429') || errMsg.includes('rate limit') || errMsg.includes('מגבלת קצב')) {
        display = '⏳ עומס על שרתי ה-AI — אנא המתן 10-15 שניות ונסה שוב.';
      } else if (errMsg.includes('status code 400')) {
        display = '⚠️ השרת דחה את הבקשה (400) — ייתכן שהמסמכים אינם קריאים. נסה קבצים אחרים או באיכות גבוהה יותר.';
      } else if (errCode === 'SERVER_ERROR' || errMsg.includes('status code 500') || errMsg.includes('500')) {
        display = '🛑 שגיאת שרת פנימית (500) — מנוע החילוץ נתקל בתקלה. אנא נסה שוב; אם התקלה חוזרת, נסה להעלות פחות מסמכים בכל פעם.';
      } else {
        display = 'שגיאה בניתוח: ' + errMsg;
      }
      // עצירה מוחלטת: ננקה תוצאה חלקית/ישנה ונציג את השגיאה במקום לרנדר דוח ולקרוס
      setResult(null);
      setErrorState({ text: display, code: errCode });
      toast.error(display, { duration: 9000 });
    } finally {
      setIsChecking(false);
    }
  };

  const downloadPDF = async () => {
    if (!result) return;
    
    try {
      toast.loading('מייצר PDF מלא...');
      const element = document.getElementById('pdf-report');
      
      const options = {
        margin: 10,
        filename: `דוח_חיתום_${result.borrower_info?.name || 'לקוח'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf().set(options).from(element).save();
      
      toast.dismiss();
      toast.success('✅ הדוח הורד בהצלחה!');
    } catch (error) {
      toast.dismiss();
      console.error('PDF error:', error);
      toast.error('שגיאה בהורדת PDF');
    }
  };

  // ── יצירת תיק הגשה מלא (מכתב נלווה + מסמכים ממוזגים) ──
  // DEFERRED: relied on base44.entities.MortgageCase/Document and buildUnifiedSubmissionPdf,
  // none of which exist on the Supabase infra (webhook hand-off to the live Base44 app is the
  // planned replacement but isn't built yet). Kept in place — same signature, same button wired
  // up in QuickCheckReport — but made inert so it fails safely instead of throwing.
  const buildFullPackage = async () => {
    toast.error('התכונה הזו עדיין לא זמינה');
  };

  // DEFERRED: relied on base44.entities.MortgageCase.create, which doesn't exist on the
  // Supabase infra (webhook hand-off to the live Base44 app is the planned replacement but
  // isn't built yet). Kept in place — same signature, same button — but made inert.
  const transferToFullProcess = async () => {
    toast.error('התכונה הזו עדיין לא זמינה');
  };

  const isRefinancePlusType = reportType === 'מחזור משכנתא + תוספת הון';

  const handleReset = () => {
    setFiles([]);
    setResult(null);
    setErrorState(null);
    setPreScanResult(null);
    setProgress(0);
    setUploadedFileUrls([]);
    setUploadedUrlsForScan([]);
    setAdditionalAmount('');
    setManualPropertyValue('');
    setProposedMortgagePayment('');
    setIntakeQuestions(null);
    setActiveResultTab('quick');
    cachedExtractedDataRef.current = null;
  };

  const reportTypeLabels = {
    'זיהוי אוטומטי': { emoji: '🤖', desc: 'ה-AI יסרוק את המסמכים ויזהה את סוג התיק בעצמו (מומלץ)' },
    'מחזור משכנתא': { emoji: '🏠', desc: 'ניתוח יתרת סילוק, מסלולים וחיסכון פוטנציאלי' },
    'מחזור משכנתא + תוספת הון': { emoji: '💰', desc: 'מחזור המשכנתא הקיימת + סכום נוסף ללקוח' },
    'מיחזור משכנתא ואיחוד חובות': { emoji: '🏦', desc: 'משכנתא לכל מטרה כולל איחוד חובות' },
    'רכישת נכס חדש': { emoji: '🏡', desc: 'ניתוח כושר החזר ואישור הכנסות לרכישה' },
    'בעלי עסקים וחברות': { emoji: '💼', desc: 'ניתוח דוחות כספיים ותזרים עסקי' },
    'גיל הזהב': { emoji: '👴', desc: 'פתרונות משכנתא מותאמים לגיל הזהב' },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-12" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-full mb-5">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-black text-amber-400 tracking-tight uppercase">מנוע סיווג חכם (Auto-Triage)</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-tight">
            בדיקת מסמכים מהירה
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto">
            העלו מסמכים וה-AI של מיקוד משכנתאות יזהה אוטומטית את סוג התיק ויבצע ניתוח כירורגי.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 md:p-8 mb-6 shadow-2xl">

          {/* Step 1: Report Type */}
          <div className="mb-6">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">שלב 1 — כוונת הלקוח (אופציונלי)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(reportTypeLabels).map(([type, info]) => (
                <button
                  key={type}
                  onClick={() => setReportType(type)}
                  className={`text-right p-4 rounded-xl border-2 transition-all ${
                    reportType === type
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                  } ${type === 'זיהוי אוטומטי' ? 'sm:col-span-2 bg-gradient-to-r from-slate-900 to-slate-800 border-amber-500/50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{info.emoji}</span>
                    <span className={`font-bold text-sm ${reportType === type ? 'text-amber-400' : 'text-white'}`}>{type}</span>
                    {reportType === type && <CheckCircle2 className="w-4 h-4 text-amber-400 mr-auto" />}
                  </div>
                  <p className="text-xs text-slate-400">{info.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* שדה תוספת הון - רק למחזור + תוספת */}
          {isRefinancePlusType && (
            <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <label className="block text-sm font-bold text-amber-400 mb-2">
                💰 סכום התוספת המבוקש (מעבר ליתרת הסילוק)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold">₪</span>
                <input
                  type="text"
                  placeholder="לדוגמה: 200,000"
                  value={additionalAmount ? Number(String(additionalAmount).replace(/,/g, '')).toLocaleString('he-IL') : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    setAdditionalAmount(raw);
                  }}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                הסכום הכולל = יתרת הסילוק הנוכחית + תוספת זו. ה-AI יחשב PTI על הסכום הכולל.
              </p>
            </div>
          )}

          {/* שדות נוספים — שווי נכס + החזר חדש */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 bg-slate-900/60 border border-slate-600 rounded-xl">
              <label className="block text-xs font-bold text-slate-300 mb-2">🏠 שווי נכס מוערך (אופציונלי)</label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-bold text-sm">₪</span>
                <input
                  type="text"
                  placeholder="לדוגמה: 2,500,000"
                  value={manualPropertyValue ? Number(String(manualPropertyValue).replace(/,/g, '')).toLocaleString('he-IL') : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    setManualPropertyValue(raw);
                  }}
                  className="flex-1 bg-transparent border-0 text-white font-bold text-sm focus:outline-none placeholder:text-slate-600"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">לחישוב LTV אוטומטי</p>
            </div>
            <div className="p-4 bg-slate-900/60 border border-slate-600 rounded-xl">
              <label className="block text-xs font-bold text-slate-300 mb-2">📊 החזר משכנתא חדשה (אופציונלי)</label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-bold text-sm">₪</span>
                <input
                  type="text"
                  placeholder="לדוגמה: 7,500"
                  value={proposedMortgagePayment ? Number(String(proposedMortgagePayment).replace(/,/g, '')).toLocaleString('he-IL') : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    setProposedMortgagePayment(raw);
                  }}
                  className="flex-1 bg-transparent border-0 text-white font-bold text-sm focus:outline-none placeholder:text-slate-600"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">לחישוב PTI ריאלי לבנקאי</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-700/50 my-6" />

          {/* Step 2: File Upload */}
          <div className="mb-6">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">שלב 2 — העלאת מסמכים</p>
            <div
              onClick={() => document.getElementById('file-upload-input').click()}
              className="border-2 border-dashed border-slate-600 rounded-2xl p-10 text-center hover:border-amber-500/60 hover:bg-amber-500/5 transition-all cursor-pointer"
            >
              <Upload className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <p className="text-base font-bold text-white mb-1">גרור לכאן או לחץ להעלאה</p>
              <p className="text-sm text-slate-400">תלושי שכר, דפי חשבון, תעודת זהות, יתרת סילוק</p>
              <p className="text-xs text-slate-500 mt-2">PDF, JPG, PNG — עד 10MB לקובץ</p>
              <input
                type="file"
                id="file-upload-input"
                multiple
                accept="image/*,application/pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                    <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span className="flex-1 font-medium text-sm text-white truncate">{file.name}</span>
                    <span className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      onClick={() => removeFile(idx)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {isChecking && (
            <div className="mb-6 bg-slate-900/70 border border-amber-500/30 rounded-xl p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2 text-white font-bold">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span>
                    {progress < 15 ? '📦 דוחס קבצים...' :
                     progress < 25 ? '☁️ מעלה לשרת...' :
                     progress < 55 ? `🧠 מנתח ${files.length} מסמכים (Gemini AI)...` :
                     progress < 65 ? '🔎 מצליב נתונים בין מסמכים...' :
                     progress < 75 ? '🕵️ מזהה חובות נסתרים (Shadow Debt)...' :
                     progress < 85 ? '📐 מחשב PTI, LTV וכושר החזר...' :
                     progress < 98 ? '✍️ בונה מכתב חיתומי לבנק...' : '✅ מסיים...'}
                  </span>
                </div>
                <span className="font-black text-amber-400">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2.5" />
              <p className="text-xs text-slate-400 text-center">
                {files.length > 8
                  ? `⏳ תיק מורכב עם ${files.length} מסמכים — העיבוד עשוי לקחת 2-4 דקות. אנא המתן.`
                  : '⏳ העיבוד עשוי לקחת 1-2 דקות — אל תסגור את הדף'}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            {/* Pre-Scan button */}
            <Button
              onClick={runPreScan}
              disabled={files.length === 0 || isPreScanning || isChecking}
              variant="outline"
              className="w-full h-12 border-2 border-slate-500 hover:border-amber-400 text-slate-200 hover:text-amber-400 font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-slate-900/40"
            >
              {isPreScanning ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  סורק מסמכים...
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4 ml-2" />
                  🔍 סרוק מה יש בתיק (מהיר)
                </>
              )}
            </Button>

            {/* Full analysis button */}
            <Button
              onClick={runQuickCheck}
              disabled={files.length === 0 || isChecking || isPreScanning}
              className="w-full h-14 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-black text-base rounded-xl shadow-xl shadow-amber-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:-translate-y-0.5"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-5 h-5 ml-2 animate-spin" />
                  מנתח תיק...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 ml-2" />
                  {files.length > 0 ? `הפק דוח מלא — ${files.length} קבצים →` : 'התחל ניתוח מסמכים'}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Tab bar — only once both a quick scan AND a full report exist; switches between them
            without discarding either. Before that point there's only one thing to show, so no
            tabs are rendered (avoids a pointless single-tab UI). */}
        {preScanResult && result && result.borrower_info && !intakeQuestions && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveResultTab('quick')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all border-2 flex items-center justify-center gap-2 ${
                activeResultTab === 'quick'
                  ? 'bg-slate-700 border-amber-400 text-white'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <ScanSearch className="w-4 h-4" />
              סריקה מהירה
            </button>
            <button
              onClick={() => setActiveResultTab('full')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all border-2 flex items-center justify-center gap-2 ${
                activeResultTab === 'full'
                  ? 'bg-slate-700 border-amber-400 text-white'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <Zap className="w-4 h-4" />
              דוח מלא
            </button>
          </div>
        )}

        {/* Pre-Scan Result Card — shown on its own before a full report exists, or as the
            "סריקה מהירה" tab once both exist (kept, not discarded, once the full report runs). */}
        {preScanResult && !intakeQuestions && (!result || activeResultTab === 'quick') && (
          <PreScanResult
            scanResult={preScanResult}
            onSuggestType={(type) => setReportType(type)}
            onRunAnalysis={(type) => runQuickCheck(type)}
          />
        )}

        {/* Intake Questions Panel — מוצג אחרי חילוץ נתונים, לפני הדוח */}
        {intakeQuestions && !result && (
          <IntakeQuestionsPanel
            questions={intakeQuestions}
            diagnosis={intakeDiagnosis}
            isLoading={isChecking}
            onSubmit={(answers) => {
              setIntakeQuestions(null);
              runQuickCheck(reportType, answers);
            }}
          />
        )}

        {/* Generating questions loading */}
        {isGeneratingQuestions && (
          <div className="bg-slate-800/60 border border-amber-500/20 rounded-2xl p-6 mb-6 flex items-center gap-4">
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
            <div>
              <p className="text-white font-bold text-sm">מנתח את התיק ומייצר שאלות ממוקדות...</p>
              <p className="text-slate-400 text-xs">מזהה פערים ונקודות בירור על פי המסמכים שלך</p>
            </div>
          </div>
        )}

        {/* ── שומר הסף: הצגת שגיאה מפורשת במקום קריסת null ── */}
        {errorState && !result && (
          <div className="mb-4">
            <ErrorMessage text={errorState.text} code={errorState.code} />
            <div className="flex justify-end">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-all border border-slate-600 hover:border-red-500"
              >
                <X className="w-4 h-4" />
                נסה שוב
              </button>
            </div>
          </div>
        )}

        {/* Reset button when result is shown */}
        {result && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-all border border-slate-600 hover:border-red-500"
            >
              <X className="w-4 h-4" />
              התחל מחדש
            </button>
          </div>
        )}

        {/* Results — Early Return מוחלט: רק אם יש result עם borrower_info, אחרת לא לרנדר ולקרוס.
            Hidden while the "סריקה מהירה" tab is active (only relevant when a pre-scan result
            also exists — otherwise there's no tab to switch away to). */}
        {result && result.borrower_info && (!preScanResult || activeResultTab === 'full') && (
          <>
            {result._missingCritical?.length > 0 && (
              <div className="mb-4 bg-red-950/60 border-2 border-red-500/60 rounded-2xl p-5">
                <div className="flex items-start gap-3 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-black text-red-300 text-sm mb-1">⚠️ הדוח חסר נתוני ליבה — מסמכי הכנסה לא הועלו</p>
                    <p className="text-xs text-red-400">הדוח שנוצר חלקי בלבד. כדי לקבל ניתוח חיתום מלא, יש להעלות:</p>
                  </div>
                </div>
                <ul className="space-y-1.5 mr-8">
                  {result._missingCritical.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-red-300">
                      <span className="text-red-500">✗</span>
                      <span className="font-bold">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 mr-8 p-3 bg-amber-900/30 border border-amber-500/30 rounded-xl">
                  <p className="text-xs text-amber-300 font-bold">💡 מה להעלות:</p>
                  <p className="text-xs text-amber-400 mt-1">שכיר: 3 תלושי שכר + ת.ז | עצמאי: שומות מס 2 שנים + מכתב רו"ח | גמלאי: תלוש קצבה</p>
                </div>
              </div>
            )}
            <QuickCheckReport
              result={result}
              reportType={reportType}
              onTransfer={transferToFullProcess}
              onBuildFullPackage={buildFullPackage}
              preScanResult={preScanResult}
            />
          </>
        )}

        {/* LEGACY kept below hidden - do not remove */}
        {false && result && (
          <div id="pdf-report" className="bg-white">
            <Card className="shadow-2xl border-2 border-amber-500/30">
              <div className="h-2 w-full bg-gradient-to-r from-amber-500 to-amber-600" />
              <CardContent className="p-8 lg:p-12" style={{ pageBreakInside: 'avoid' }}>
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start gap-6 mb-12 pb-12 border-b-2 border-slate-200">
                  <div className="flex-1">
                    <Badge className="bg-emerald-100 text-emerald-700 border-2 border-emerald-200 mb-4 px-4 py-1.5 text-xs font-black uppercase tracking-wide">
                      ניתוח חיתום מאושר
                    </Badge>
                    <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">
                      {result.borrower_info?.name || 'לא זוהה'}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-bold">תעודת זהות</p>
                        <p className="font-bold text-slate-900">{result.borrower_info?.id || 'N/A'}</p>
                      </div>
                      {reportType !== 'מחזור משכנתא' && reportType !== 'גיל הזהב' && (
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-bold">מעסיק</p>
                          <p className="font-bold text-slate-900">{result.borrower_info?.employer || 'לא צוין'}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-bold">הכנסה חודשית</p>
                        <p className="text-2xl font-black text-amber-600">₪{result.borrower_info?.avg_income?.toLocaleString() || '0'}</p>
                      </div>
                                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-bold">גיל</p>
                        {result.borrower_info?.age ? (
                          <p className="text-2xl font-black text-slate-900">{result.borrower_info.age}</p>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder="הכנס גיל"
                              min="18" max="99"
                              className="w-20 border-2 border-amber-400 rounded-lg px-2 py-1 text-sm font-bold"
                              onChange={e => setResult(prev => ({
                                ...prev,
                                borrower_info: { ...prev.borrower_info, age: parseInt(e.target.value) || null }
                              }))}
                            />
                            <span className="text-xs text-slate-500">ידני</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button onClick={downloadPDF} className="bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-xl">
                    <Download className="w-4 h-4 ml-2" />
                    הורד PDF
                  </Button>
                </div>

                {/* Executive Summary */}
                <section className="mb-12" style={{ pageBreakInside: 'avoid' }}>
                  <h3 className="text-xl font-black text-amber-600 mb-6 flex items-center gap-3 uppercase tracking-wide">
                    <div className="h-1 w-16 bg-amber-600" />
                    סיכום חיתומי
                  </h3>
                  <div className="bg-gradient-to-br from-slate-50 to-white border-r-4 border-amber-600 pr-8 py-6 rounded-xl leading-relaxed text-slate-700 whitespace-pre-wrap text-base">
                    {result.executive_summary || 'לא זמין'}
                  </div>
                </section>

                {/* Yearly Summary */}
                {result.yearly_summary && (
                  <section className="mb-12 bg-blue-50 p-8 rounded-2xl border-2 border-blue-200" style={{ pageBreakInside: 'avoid' }}>
                    <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-3 uppercase tracking-wide">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      ניתוח שנתי (YTD)
                    </h3>
                    <p className="text-base leading-loose text-slate-700 whitespace-pre-wrap">
                      {result.yearly_summary}
                    </p>
                  </section>
                )}

                {/* Risk Radar */}
                {result.risk_radar && result.risk_radar.length > 0 && (
                  <section className="mb-12" style={{ pageBreakBefore: 'auto' }}>
                    <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3 uppercase tracking-wide">
                      <div className="h-1 w-16 bg-slate-900" />
                      מטריצת סיכונים
                    </h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      {result.risk_radar.map((risk, idx) => (
                        <div key={idx} className="p-8 bg-white border-2 border-slate-200 rounded-2xl hover:shadow-xl transition-all">
                          <div className="flex justify-between items-start mb-4">
                            <Badge className={`font-bold uppercase tracking-wide ${
                              risk.severity === 'HIGH' ? 'bg-red-100 text-red-700 border-2 border-red-300' :
                              risk.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-300' :
                              'bg-green-100 text-green-700 border-2 border-green-300'
                            }`}>
                              {risk.severity}
                            </Badge>
                            <span className="text-xs text-slate-500 uppercase tracking-wide font-bold">{risk.category}</span>
                          </div>
                          <p className="text-base font-bold text-slate-800 leading-relaxed">{risk.finding}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Missing Documents */}
                {result.missing_docs && result.missing_docs.length > 0 && (
                  <section className="bg-red-50 p-8 rounded-2xl border-2 border-red-200" style={{ pageBreakInside: 'avoid' }}>
                    <h3 className="text-red-900 font-black text-lg uppercase tracking-wide mb-6 flex items-center gap-3">
                      <AlertTriangle className="w-6 h-6" />
                      מסמכים חסרים
                    </h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      {result.missing_docs.map((doc, idx) => (
                        <div key={idx} className="bg-white border-2 border-red-200 text-red-900 font-bold px-6 py-4 rounded-xl flex items-center justify-between shadow-sm">
                          <span>{doc}</span>
                          <XCircle className="w-5 h-5 text-red-500" />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Call to Action - Transfer to Full Process */}
                <div className="mt-12 p-8 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl">
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-black text-slate-900 mb-2">
                      מוכנים להתקדם?
                    </h3>
                    <p className="text-slate-600">
                      העבירו את התיק לתהליך הדיגיטלי המלא - חתימות, תמהילים והגשה לבנקים
                    </p>
                  </div>
                  <Button
                    onClick={transferToFullProcess}
                    className="w-full h-16 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-black text-lg rounded-xl shadow-2xl shadow-green-500/40"
                  >
                    <ArrowLeft className="w-6 h-6 ml-2" />
                    העבר לתהליך המלא
                  </Button>
                  <p className="text-xs text-center text-slate-500 mt-4">
                    כל הנתונים והמסמכים יועברו אוטומטית - לא צריך למלא שוב
                  </p>
                </div>

                {/* Footer */}
                <div className="mt-16 pt-8 border-t-2 border-slate-200 text-center">
                  <div className="flex items-center justify-center gap-3 opacity-40">
                    <Star className="w-4 h-4 text-amber-600 fill-amber-600" />
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      מיקוד משכנתאות • מערכת ניתוח מתקדמת
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}