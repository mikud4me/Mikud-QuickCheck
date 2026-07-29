import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase, uploadFileToStorage, parseInvokeError, getStoragePathFromSignedUrl } from '@/api/supabaseClient';
import {
  Upload, Loader2, DollarSign, 
  CheckCircle, AlertCircle, Lock, TrendingUp, X, ChevronDown, ChevronUp, Download
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import RefinanceCalculator from '../components/refinance/RefinanceCalculator';
import CalculationBreakdown from '../components/refinance/CalculationBreakdown';
import BleedingPathChart from '../components/refinance/BleedingPathChart.jsx';
import BalloonTrapAlert from '../components/refinance/BalloonTrapAlert';
import ExecutiveSummary from '../components/refinance/ExecutiveSummary';
import DualStrategyCard from '../components/refinance/DualStrategyCard';
import LiveRatesBadge from '../components/refinance/LiveRatesBadge';
import { isValidIsraeliID, isValidEmail, isValidIsraeliPhone } from '@/components/utils/validators';

// מקור אמת יחיד למספרי הליבה שחוזרים על עצמם בכמה מקומות בדוח (חיסכון נטו, החזר חדש, ריבית חדשה וכו')
function buildHeadline(analysisResult) {
  const { currentLoan, savings } = analysisResult;
  const era = savings?.equityReleaseAnalysis;
  const useEquityRelease = !!era; // תיק איחוד חובות: המספרים המשולבים הם מה שתג סוג התיק כבר מבטיח למשתמש

  return {
    currentMonthlyPayment: currentLoan?.monthlyPayment,
    currentAverageRate: currentLoan?.averageInterestRate,
    newMonthlyPayment: useEquityRelease ? era.newMonthlyPayment : savings?.newMonthlyPayment,
    newAverageRate: useEquityRelease ? era.allPurposeRate : savings?.newAverageRate,
    monthlySavings: useEquityRelease ? era.monthlyCashFlowImprovement : savings?.monthlySavings,
    netSavings: savings?.netSavings,
    isWorthwhile: savings?.isWorthwhile,
    breakEvenMonths: savings?.breakEvenMonths
  };
}

export default function RefinanceQuickCheck() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const transactionType = 'refinance';
  const [progress, setProgress] = useState(0);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfTrigger, setPdfTrigger] = useState(0);
  const [hasExtraDebts, setHasExtraDebts] = useState(null); // null=לא נבחר, true/false
  const [extraDebts, setExtraDebts] = useState([{ creditor: '', monthly_repayment: '', remaining_balance: '', estimated_interest: 15 }]);

  // פרטי קשר — נאספים לפני העלאת המסמך ונשמרים כליד
  const [leadId, setLeadId] = useState(null);
  const [tier, setTier] = useState('free'); // נשמר לצורך שלב הבא (הצגת שכבות free/paid/premium) — לא משפיע על התצוגה כרגע
  const [isResumingLead, setIsResumingLead] = useState(true);
  const [contactFullName, setContactFullName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactIdNumber, setContactIdNumber] = useState('');
  const [contactErrors, setContactErrors] = useState({});
  const [contactTouched, setContactTouched] = useState({});
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);
  const markContactTouched = (field) => setContactTouched(t => ({ ...t, [field]: true }));

  // שחזור ליד קיים לפי ?lead= בכתובת (למשל אחרי רענון דף)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('lead');
    if (!id) { setIsResumingLead(false); return; }

    (async () => {
      try {
        // .single() errors (PGRST116) when zero rows match — treat that the same as "no lead"
        // rather than surfacing it, matching the old entity.get()'s "returns falsy" behavior.
        const { data: lead, error: leadError } = await supabase
          .from('refinance_leads')
          .select('*')
          .eq('id', id)
          .single();
        if (leadError || !lead) return;
        setLeadId(lead.id);
        setTier(lead.tier || 'free');
        setContactFullName(lead.full_name || '');
        setContactEmail(lead.email || '');
        setContactPhone(lead.phone || '');
        setContactIdNumber(lead.id_number || '');
        if (lead.status === 'analyzed' && lead.analysis_result) {
          setAnalysisResult({ ...lead.analysis_result, file_url: lead.file_url });
        }
      } catch (err) {
        console.error('Failed to resume lead from URL:', err);
      } finally {
        setIsResumingLead(false);
      }
    })();
  }, []);

  const headline = useMemo(
    () => analysisResult ? buildHeadline(analysisResult) : null,
    [analysisResult]
  );

  useEffect(() => {
    if (!isAnalyzing) { setProgress(0); return; }
    setProgress(10);
    const t1 = setTimeout(() => setProgress(40), 3000);
    const t2 = setTimeout(() => setProgress(70), 10000);
    const t3 = setTimeout(() => setProgress(88), 20000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isAnalyzing]);


  const getContactErrors = () => {
    const errors = {};
    if (!contactFullName.trim() || contactFullName.trim().length < 2) errors.fullName = 'אנא הזן שם מלא';
    if (!isValidEmail(contactEmail)) errors.email = 'כתובת אימייל לא תקינה';
    if (!isValidIsraeliPhone(contactPhone)) errors.phone = 'מספר טלפון לא תקין';
    if (!isValidIsraeliID(contactIdNumber)) errors.idNumber = 'תעודת זהות לא תקינה';
    return errors;
  };

  const liveContactErrors = useMemo(
    () => getContactErrors(),
    [contactFullName, contactEmail, contactPhone, contactIdNumber]
  );
  const isContactFormValid = Object.keys(liveContactErrors).length === 0;

  const handleContactSubmit = async () => {
    const errors = getContactErrors();

    if (Object.keys(errors).length > 0) {
      setContactTouched({ fullName: true, idNumber: true, phone: true, email: true });
      return;
    }

    setContactErrors({});
    setIsSubmittingContact(true);
    try {
      const { data: lead, error: createError } = await supabase
        .from('refinance_leads')
        .insert({
          full_name: contactFullName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
          id_number: contactIdNumber.trim()
        })
        .select()
        .single();
      if (createError) throw createError;
      setLeadId(lead.id);
      const url = new URL(window.location.href);
      url.searchParams.set('lead', lead.id);
      window.history.replaceState(null, '', url);
    } catch (err) {
      console.error('Failed to save contact details:', err);
      setContactErrors({ submit: 'שגיאה בשמירת הפרטים. נסה שוב.' });
    } finally {
      setIsSubmittingContact(false);
    }
  };

  const updateLead = async (data) => {
    if (!leadId) return;
    try {
      const { error: updateError } = await supabase.from('refinance_leads').update(data).eq('id', leadId);
      if (updateError) throw updateError;
    } catch (err) {
      console.error('Failed to update lead record:', err);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles([selectedFiles[0]]); // רק קובץ אחד
    }
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setError('אנא העלה לפחות קובץ אחד');
      return;
    }

    setError(null);
    setIsAnalyzing(true);

    let file_url = null;
    // analyzeRefinanceDocument needs the plain storage path, not the signed
    // URL -- see getStoragePathFromSignedUrl's comment in supabaseClient.js.
    // file_url itself stays the signed URL, used for the lead record/local
    // display exactly as before. Declared here (not inside the try block)
    // so it's also in scope for the retry attempt in the catch block below.
    let file_path = null;

    try {
      file_url = await uploadFileToStorage(files[0]);
      file_path = getStoragePathFromSignedUrl(file_url);

      // Build external debts array if user indicated they have extra debts
      const externalDebtsInput = hasExtraDebts
        ? extraDebts
            .filter(d => d.creditor && d.monthly_repayment > 0)
            .map(d => ({
              creditor: d.creditor,
              monthly_repayment: parseFloat(d.monthly_repayment) || 0,
              remaining_balance: parseFloat(d.remaining_balance) || 0,
              estimated_interest: parseFloat(d.estimated_interest) || 15
            }))
        : [];

      const { data, error } = await supabase.functions.invoke('analyzeRefinanceDocument', {
        body: {
          file_url: file_path,
          loan_period_years: 20,
          transaction_type: transactionType,
          external_debts_input: externalDebtsInput
        }
      });

      if (error) {
        // analyzeRefinanceDocument always returns HTTP 200, even for success:false analysis
        // failures — a populated `error` here means a true gateway/network failure (502/timeout),
        // not an analysis rejection. Throw so the outer catch's retry logic picks it up.
        throw error;
      }

      if (!data?.success) {
        const errorMsg = data?.error || 'שגיאה בניתוח הקובץ. ודא שהמסמך הוא דף יתרת סילוק תקין מהבנק.';
        setError(`❌ ${errorMsg}`);
        return;
      }

      setAnalysisResult({ ...data, file_url });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateLead({
        status: 'analyzed',
        file_url,
        has_extra_debts: hasExtraDebts,
        external_debts: externalDebtsInput,
        analysis_result: data,
        analyzed_at: new Date().toISOString()
      });

    } catch (err) {
      console.error('Analysis error:', err);

      // Retry once if we have the file_url already uploaded. supabase-js has no axios-style
      // err.code/err.response — network/relay failures are FunctionsFetchError/FunctionsRelayError
      // instances, and a genuine gateway timeout surfaces as a FunctionsHttpError whose message
      // mentions the status. Match on message text (and error name) rather than the old axios shape.
      const isRetryable = err?.message?.includes('502') || err?.message?.includes('504') || err?.message?.includes('timeout') || err?.message?.includes('Network Error') || err?.name === 'FunctionsFetchError' || err?.name === 'FunctionsRelayError';
      if (file_url && isRetryable) {
        try {
          const { data: retryData, error: retryError } = await supabase.functions.invoke('analyzeRefinanceDocument', {
            body: { file_url: file_path, loan_period_years: 20, transaction_type: transactionType }
          });
          if (retryError) {
            const errBody = await parseInvokeError(retryError);
            throw new Error(errBody?.error || retryError.message || 'שגיאה בניתוח הקובץ');
          }
          if (!retryData?.success) {
            throw new Error(retryData?.error || 'שגיאה בניתוח הקובץ');
          }
          setAnalysisResult({ ...retryData, file_url });
          window.scrollTo({ top: 0, behavior: 'smooth' });
          updateLead({
            status: 'analyzed',
            file_url,
            has_extra_debts: hasExtraDebts,
            analysis_result: retryData,
            analyzed_at: new Date().toISOString()
          });
          return;
        } catch (retryErr) {
          setError('⏱️ הניתוח לוקח זמן רב. נסה להעלות קובץ קטן יותר, או צור איתנו קשר ישירות.');
        }
      } else {
        setError(`❌ שגיאה בניתוח: ${err.message}. נסה שוב או צור קשר.`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A192F] via-[#0F2442] to-[#0A192F] py-12" dir="rtl">
      <div className="max-w-5xl mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="glass-card inline-flex items-center gap-2 px-5 py-2.5 mb-5 border-2 border-[#C5A059]/40">
            <span className="text-sm font-black text-white tracking-tight uppercase">ניתוח מחזור כירורגי</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-tight">כמה כסף תחסוך במחזור?</h1>
          <p className="text-[#8892B0] max-w-xl mx-auto">העלה יתרת סילוק משכנתא וקבל מיד חישוב חיסכון אמיתי</p>
          <div className="flex items-center justify-center gap-6 text-sm text-[#8892B0] mt-4">
            <div className="flex items-center gap-1.5"><span>ריביות שוק אמיתיות</span></div>
            <div className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-[#8892B0]" /><span>מאובטח</span></div>
            <div className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-400" /><span>חינם</span></div>
          </div>
        </motion.div>

        {isResumingLead && !analysisResult && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
          </div>
        )}

        {!isResumingLead && !leadId && !analysisResult && (
          <div className="glass-card border-2 border-[#C5A059]/30 rounded-2xl p-6 md:p-8 mb-6 shadow-2xl">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-2">פרטים אישיים</p>
                <p className="text-sm text-[#8892B0]">לפני העלאת המסמך, נשמח לקבל כמה פרטים ליצירת קשר</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <input
                    placeholder="שם מלא"
                    value={contactFullName}
                    onChange={e => setContactFullName(e.target.value)}
                    onBlur={() => markContactTouched('fullName')}
                    disabled={isSubmittingContact}
                    className="w-full bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-4 py-3 text-white text-sm placeholder-[#8892B0]"
                  />
                  {contactTouched.fullName && liveContactErrors.fullName && <p className="text-xs text-red-400 mt-1">{liveContactErrors.fullName}</p>}
                </div>
                <div>
                  <input
                    placeholder="תעודת זהות"
                    value={contactIdNumber}
                    onChange={e => setContactIdNumber(e.target.value)}
                    onBlur={() => markContactTouched('idNumber')}
                    disabled={isSubmittingContact}
                    className="w-full bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-4 py-3 text-white text-sm placeholder-[#8892B0]"
                  />
                  {contactTouched.idNumber && liveContactErrors.idNumber && <p className="text-xs text-red-400 mt-1">{liveContactErrors.idNumber}</p>}
                </div>
                <div>
                  <input
                    placeholder="טלפון"
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    onBlur={() => markContactTouched('phone')}
                    disabled={isSubmittingContact}
                    className="w-full bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-4 py-3 text-white text-sm placeholder-[#8892B0]"
                  />
                  {contactTouched.phone && liveContactErrors.phone && <p className="text-xs text-red-400 mt-1">{liveContactErrors.phone}</p>}
                </div>
                <div>
                  <input
                    placeholder="אימייל"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    onBlur={() => markContactTouched('email')}
                    disabled={isSubmittingContact}
                    className="w-full bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-4 py-3 text-white text-sm placeholder-[#8892B0]"
                  />
                  {contactTouched.email && liveContactErrors.email && <p className="text-xs text-red-400 mt-1">{liveContactErrors.email}</p>}
                </div>
              </div>

              {contactErrors.submit && (
                <div className="glass-card border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{contactErrors.submit}</p>
                </div>
              )}

              <Button
                onClick={handleContactSubmit}
                disabled={isSubmittingContact || !isContactFormValid}
                className="w-full h-14 bg-gradient-to-r from-[#C5A059] to-[#917642] hover:from-[#D4AF37] hover:to-[#C5A059] text-[#0A192F] font-black text-base rounded-xl shadow-xl transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmittingContact ? (
                  <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> שומר...</>
                ) : (
                  'המשך להעלאת מסמך ←'
                )}
              </Button>
            </div>
          </div>
        )}

        {leadId && !analysisResult && (
          <div className="glass-card border-2 border-[#C5A059]/30 rounded-2xl p-6 md:p-8 mb-6 shadow-2xl">
            <div className="space-y-6">

              {/* מה להעלות */}
              <div className="glass-card border border-[#C5A059]/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-[#D4AF37]" />
                  <h3 className="font-bold text-white text-sm">מה להעלות?</h3>
                </div>
                <ul className="text-xs text-[#8892B0] space-y-1">
                  <li>✓ דף יתרת סילוק משכנתא מהבנק המלווה בלבד</li>
                  <li>אין צורך להעלות מסמכים נוספים בשלב זה</li>
                </ul>
              </div>

              {/* אזור העלאה */}
              <div>
                <p className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-3">העלאת דף יתרת סילוק</p>
                <div
                  onClick={() => document.getElementById('refinance-files').click()}
                  className="border-2 border-dashed border-[#C5A059]/50 rounded-2xl p-10 text-center hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 transition-all cursor-pointer"
                >
                  <Upload className="w-12 h-12 text-[#8892B0] mx-auto mb-3" />
                  <p className="text-base font-bold text-white mb-1">גרור לכאן או לחץ להעלאה</p>
                  <p className="text-sm text-[#8892B0]">PDF, JPG, PNG — העלה דף יתרת סילוק בלבד (קובץ אחד)</p>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="refinance-files"
                    disabled={isAnalyzing}
                  />
                </div>

                {files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center gap-3 glass-card p-3 rounded-xl border border-[#C5A059]/30">
                        <span className="w-6 h-6 bg-[#D4AF37]/20 rounded-lg flex items-center justify-center text-xs font-bold text-[#D4AF37] flex-shrink-0">{index + 1}</span>
                        <span className="flex-1 font-medium text-sm text-white truncate">{file.name}</span>
                        <span className="text-xs text-[#8892B0]">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button onClick={() => removeFile(index)} className="text-[#8892B0] hover:text-red-400 transition-colors p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {isAnalyzing && (
                <div className="glass-card border border-[#C5A059]/30 rounded-xl p-5 space-y-3">
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center gap-2 text-white font-bold">
                      <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                      מנתח מסמך...
                    </div>
                    <span className="font-black text-[#D4AF37]">{progress}%</span>
                  </div>
                  <div className="w-full bg-[#172A45] rounded-full h-2">
                    <div className="bg-gradient-to-r from-[#C5A059] to-[#D4AF37] h-2 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-[#8892B0] text-center">ניתוח מעמיק — עשוי לקחת 20-40 שניות</p>
                </div>
              )}

              {/* שאלת הלוואות נוספות */}
              {files.length > 0 && !isAnalyzing && (
                <div className="glass-card border border-[#C5A059]/30 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-white">האם יש לך הלוואות/חובות נוספים מחוץ למשכנתא?</p>
                  <p className="text-xs text-[#8892B0]">הלוואות רכב, אשראי, מינוס בעו"ש — ניתן לאחד הכל למשכנתא אחת</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setHasExtraDebts(false)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all border-2 ${hasExtraDebts === false ? 'bg-[#C5A059] text-[#0A192F] border-[#D4AF37]' : 'border-[#C5A059]/40 text-[#8892B0] hover:border-[#C5A059]'}`}
                    >
                      לא, רק המשכנתא
                    </button>
                    <button
                      onClick={() => setHasExtraDebts(true)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all border-2 ${hasExtraDebts === true ? 'bg-[#C5A059] text-[#0A192F] border-[#D4AF37]' : 'border-[#C5A059]/40 text-[#8892B0] hover:border-[#C5A059]'}`}
                    >
                      כן, יש לי חובות נוספים
                    </button>
                  </div>

                  {hasExtraDebts === true && (
                    <div className="space-y-2 mt-2">
                      {extraDebts.map((debt, idx) => (
                        <div key={idx} className="grid grid-cols-2 gap-2">
                          <input
                            placeholder="מקור החוב (למשל: הלוואת רכב)"
                            value={debt.creditor}
                            onChange={e => { const d = [...extraDebts]; d[idx].creditor = e.target.value; setExtraDebts(d); }}
                            className="col-span-2 bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-3 py-2 text-white text-xs placeholder-[#8892B0]"
                          />
                          <input
                            placeholder="החזר חודשי ₪"
                            type="number"
                            value={debt.monthly_repayment}
                            onChange={e => { const d = [...extraDebts]; d[idx].monthly_repayment = e.target.value; setExtraDebts(d); }}
                            className="bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-3 py-2 text-white text-xs placeholder-[#8892B0]"
                          />
                          <input
                            placeholder="יתרה ₪"
                            type="number"
                            value={debt.remaining_balance}
                            onChange={e => { const d = [...extraDebts]; d[idx].remaining_balance = e.target.value; setExtraDebts(d); }}
                            className="bg-[#0A192F] border border-[#C5A059]/40 rounded-lg px-3 py-2 text-white text-xs placeholder-[#8892B0]"
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => setExtraDebts([...extraDebts, { creditor: '', monthly_repayment: '', remaining_balance: '', estimated_interest: 15 }])}
                        className="text-xs text-[#C5A059] hover:text-[#D4AF37] underline"
                      >
                        + הוסף חוב נוסף
                      </button>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="glass-card border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <Button
                onClick={handleAnalyze}
                disabled={files.length === 0 || isAnalyzing || hasExtraDebts === null}
                className="w-full h-14 bg-gradient-to-r from-[#C5A059] to-[#917642] hover:from-[#D4AF37] hover:to-[#C5A059] text-[#0A192F] font-black text-base rounded-xl shadow-xl transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> מנתח...</>
                ) : (
                  files.length > 0 && hasExtraDebts !== null ? `נתח מסמך ←` : files.length > 0 ? 'בחר האם יש חובות נוספים ↑' : 'העלה מסמך והתחל ניתוח'
                )}
              </Button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {analysisResult && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} className="space-y-6">
              {/* כפתורי פעולה עליונים */}
              <div className="flex justify-between items-center gap-3 flex-wrap">
                <Button
                  onClick={() => { setIsDownloadingPdf(true); setPdfTrigger(t => t + 1); }}
                  disabled={isDownloadingPdf}
                  className="flex items-center gap-2 h-11 px-6 bg-gradient-to-r from-[#C5A059] to-[#917642] hover:from-[#D4AF37] hover:to-[#C5A059] text-[#0A192F] font-black rounded-xl shadow-xl transition-all"
                >
                  {isDownloadingPdf ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  {isDownloadingPdf ? 'מייצר PDF...' : 'הורד דוח PDF'}
                </Button>
                <button
                  onClick={() => { setAnalysisResult(null); setFiles([]); setError(null); }}
                  className="flex items-center gap-2 px-4 py-2 glass-card hover:border-[#D4AF37]/50 text-white hover:text-white text-sm font-bold rounded-xl transition-all border-2 border-[#C5A059]/40"
                >
                  <X className="w-4 h-4" />
                  התחל מחדש / העלה מסמך אחר
                </button>
              </div>
              {/* 🏷️ Badge סוג התיק */}
              <div className="flex flex-col items-center gap-3 mb-4">
                <Badge className={`text-lg px-6 py-3 ${
                  analysisResult.savings?.equityReleaseAnalysis
                    ? 'bg-gradient-to-r from-[#917642] to-[#C5A059] text-white border-2 border-[#D4AF37]'
                    : 'bg-gradient-to-r from-[#1a3a52] to-[#172A45] text-white border-2 border-[#C5A059]'
                }`}>
                  {analysisResult.savings?.equityReleaseAnalysis
                    ? '🏦 סוג התיק: משכנתא לכל מטרה (איחוד חובות)'
                    : '🏠 סוג התיק: מחזור משכנתא (דיור)'}
                </Badge>

                {analysisResult.savings?.arrearsDebt > 0 && (
                  <div className="bg-red-500/20 border-2 border-red-500 text-red-100 px-6 py-3 rounded-xl flex items-center gap-3 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse">
                    <AlertCircle className="w-6 h-6 text-red-400" />
                    <div>
                      <p className="font-black text-lg">🚨 זוהה פיגור במשכנתא: ₪{analysisResult.savings.arrearsDebt.toLocaleString()}</p>
                      <p className="text-sm">תיק מורכב - המחזור נועד להצלת הנכס והסדרת החוב</p>
                    </div>
                  </div>
                )}
              </div>

              {/* אזהרת תאריך יתרת סילוק ישן — חסימה קריטית */}
              {analysisResult.statementDateWarning && (
                <div className="bg-red-500/25 border-2 border-red-500 text-red-100 px-5 py-4 rounded-xl mb-2 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                  <div className="flex items-start gap-3 mb-3">
                    <AlertCircle className="w-6 h-6 text-red-400 shrink-0 mt-0.5 animate-pulse" />
                    <div>
                      <p className="text-base font-black text-red-200 mb-1">⛔ תיק לא כשיר להגשה לבנק</p>
                      <p className="text-sm font-semibold text-red-100">{analysisResult.statementDateWarning}</p>
                    </div>
                  </div>
                  <div className="bg-red-900/40 border border-red-500/50 rounded-lg px-4 py-3">
                    <p className="text-sm text-red-200 font-bold mb-1">⚠️ מה עושים?</p>
                    <p className="text-xs text-red-300 leading-relaxed">יש לבקש <strong>יתרת סילוק עדכנית</strong> מהבנק הנוכחי (בנק הפועלים) — ניתן להזמין באפליקציה, בסניף, או בטלפון. לאחר קבלת המסמך החדש, העלה אותו מחדש לקבלת חישוב מדויק.</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-red-300">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse flex-shrink-0"></span>
                    <span>הניתוח הכלכלי שלהלן מבוסס על יתרה שאינה עדכנית — הנתונים עשויים להשתנות</span>
                  </div>
                </div>
              )}

              {/* חוות דעת מומחה - ניתוח כדאיות */}
              {analysisResult.conclusionText && (
                <Card className="border-2 border-[#C5A059] bg-gradient-to-br from-[#172A45] to-[#0A192F] shadow-2xl mb-6">
                  <CardHeader className="border-b border-[#C5A059]/20 pb-4">
                    <CardTitle className="flex items-center gap-3 text-2xl font-black text-white">
                      חוות דעת מומחה - ניתוח כדאיות
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="text-slate-200 text-lg leading-relaxed whitespace-pre-line font-medium">
                      {analysisResult.conclusionText}
                    </div>
                    <div className="mt-5 pt-5 border-t border-[#C5A059]/20 flex items-center justify-center gap-2 text-[#D4AF37] font-bold">
                      <span>המשיכו לקרוא כדי לראות את כל האפשרויות העומדות בפניכם</span>
                      <ChevronDown className="w-5 h-5 animate-bounce" />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ריביות שוק בזמן אמת */}
              <LiveRatesBadge newRates={analysisResult.newRates} />

              {/* 2 אסטרטגיות מחזור */}
              <DualStrategyCard
                dualStrategy={analysisResult.dualStrategy}
                currentMonthlyPayment={headline.currentMonthlyPayment}
              />

              {/* 📄 Executive Summary (Now includes the printable report) */}
              <ExecutiveSummary
                analysisResult={analysisResult}
                headline={headline}
                externalTrigger={pdfTrigger}
                onTriggerDone={() => setIsDownloadingPdf(false)}
              />
              
              {/* אזור השוואה נקי וברור - לפני מול אחרי, כשני בלוקים נפרדים */}
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                {/* המשכנתא הנוכחית */}
                <div className="glass-card rounded-2xl border-2 border-red-500/40 bg-gradient-to-br from-red-950/30 to-[#172A45] p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                      <X className="w-4 h-4 text-red-400" />
                    </div>
                    <h3 className="text-xl font-black" style={{ color: '#7F1D1D' }}>המשכנתא הנוכחית</h3>
                  </div>
                  <div className="glass-card rounded-xl p-4 border border-red-500/30 bg-red-500/10 mb-3">
                    <p className="text-sm text-slate-300 mb-1">החזר חודשי</p>
                    <p className="text-3xl font-bold text-white">₪{headline.currentMonthlyPayment?.toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-card rounded-xl p-3 border border-red-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">יתרה לסילוק</p>
                      <p className="text-lg font-bold text-white">₪{analysisResult.currentLoan.remainingBalance?.toLocaleString()}</p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-red-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">ריבית ממוצעת</p>
                      <p className="text-lg font-bold text-red-400">{headline.currentAverageRate?.toFixed(2)}%</p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-red-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">ריבית אפקטיבית</p>
                      <p className="text-lg font-bold text-red-400">{(analysisResult.currentLoan.effectiveInterestRate ?? headline.currentAverageRate)?.toFixed(2)}%</p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-red-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">תקופה נותרת</p>
                      <p className="text-lg font-bold text-white">{Math.round((analysisResult.currentLoan.remainingMonths || 0) / 12)} שנים</p>
                    </div>
                  </div>
                </div>

                {/* אחרי המחזור */}
                <div className="glass-card rounded-2xl border-2 border-green-500/40 bg-gradient-to-br from-green-950/20 to-[#172A45] p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    </div>
                    <h3 className="text-xl font-black" style={{ color: '#15803D' }}>אחרי המחזור</h3>
                  </div>
                  <div className="glass-card rounded-xl p-4 border border-green-500/40 bg-green-500/10 mb-3">
                    <p className="text-sm text-green-200 mb-1">החזר חודשי חדש</p>
                    <p className="text-3xl font-bold text-green-400">₪{headline.newMonthlyPayment?.toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-card rounded-xl p-3 border border-green-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">ריבית חדשה</p>
                      <p className="text-lg font-bold text-green-400">{headline.newAverageRate?.toFixed(2)}%</p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-green-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">תקופה חדשה</p>
                      <p className="text-lg font-bold text-white">{analysisResult.newLoan?.periodYears} שנים</p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-green-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">{headline.netSavings >= 0 ? 'חיסכון חודשי' : 'הפרש חודשי'}</p>
                      <p className={`text-lg font-bold ${headline.monthlySavings >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {headline.monthlySavings >= 0 ? '' : '-'}₪{Math.abs(headline.monthlySavings || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="glass-card rounded-xl p-3 border border-green-500/20 bg-[#0A192F]/50 flex flex-col justify-center">
                      <p className="text-xs text-slate-300 mb-1">חיסכון כולל נטו</p>
                      <p className={`text-lg font-bold ${headline.netSavings >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {headline.netSavings >= 0 ? '' : '-'}₪{Math.abs(headline.netSavings || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {analysisResult.savings?.feeWarning && (
                <Card className="border-2 border-red-500 bg-red-50 mb-6">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-red-900 text-sm">שים לב: עמלת פירעון</h3>
                        <p className="text-xs text-red-800 mt-1">{analysisResult.savings.feeWarning}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* כפתור חשיפת ניתוח מתקדם */}
              <div className="text-center mb-6 mt-12">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAdvancedAnalysis(!showAdvancedAnalysis)}
                  className="bg-[#172A45] border-[#C5A059] text-white hover:bg-[#C5A059]/20 gap-2 h-12 px-6 rounded-xl shadow-lg transition-all"
                >
                  {showAdvancedAnalysis ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  <span className="font-bold text-base">
                    {showAdvancedAnalysis ? 'הסתר ניתוח כלכלי מעמיק' : 'הצג ניתוח כלכלי מעמיק (למתקדמים)'}
                  </span>
                </Button>
              </div>

              {/* אזור הניתוח המעמיק - מוסתר כברירת מחדל */}
              <AnimatePresence>
                {showAdvancedAnalysis && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-6"
                  >
                    <div className="p-6 border-2 border-[#C5A059]/20 rounded-2xl bg-[#0A192F]/50 space-y-6">
                      <h3 className="text-xl font-bold text-white text-center mb-4">ניתוח כלכלי מעמיק</h3>
                      
                      {/* <CalculationBreakdown analysisData={analysisResult} /> */}
                      
                      {/* פירוט המסלולים הקיימים */}
                      {analysisResult.currentLoan.tracks && analysisResult.currentLoan.tracks.length > 0 && (
                        <Card className="glass-card border border-[#C5A059]/30 bg-transparent">
                          <CardHeader className="pb-2"><CardTitle className="text-sm text-[#8892B0]">פירוט מסלולים קיימים</CardTitle></CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {analysisResult.currentLoan.tracks.map((track, i) => (
                                <div key={i} className="glass-card p-3 rounded-lg border border-[#C5A059]/20 text-sm">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-white">{track.track_type}</span>
                                    <span className="text-red-400 font-bold">{track.interest_rate?.toFixed(2)}%</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-[#8892B0]">
                                    <span>יתרה: ₪{track.remaining_balance?.toLocaleString()}</span>
                                    <span>נותרו: {track.remaining_months} חודשים</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      <RefinanceCalculator 
                        currentLoan={analysisResult.currentLoan}
                        newLoan={analysisResult.newLoan}
                        savings={analysisResult.savings}
                        partialRefinanceSavings={analysisResult.partialRefinanceSavings}
                        surgicalAnalysis={analysisResult.surgicalAnalysis}
                        clientInfo={{
                          borrowers: (analysisResult.currentLoan.borrowers_names || []).map((name, i) => ({
                            name,
                            idNumber: i === 0
                              ? analysisResult.currentLoan.id_number
                              : analysisResult.currentLoan.borrower_2?.id_number
                          }))
                        }}
                      />

                      {/* 🔥 המסלול המדמם */}
                      {analysisResult.currentLoan?.tracks?.some(t => t.is_index_linked || (t.track_type || '').includes('צמוד')) && (
                        <BleedingPathChart
                          tracks={analysisResult.currentLoan.tracks}
                          newMonthlyPayment={analysisResult.savings?.newMonthlyPayment}
                          newAverageRate={analysisResult.savings?.newAverageRate}
                          remainingBalance={analysisResult.currentLoan.remainingBalance}
                        />
                      )}

                      {/* ⚠️ Balloon Trap Alert */}
                      <BalloonTrapAlert
                        externalDebts={analysisResult.savings?.equityReleaseAnalysis?.externalDebts}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {analysisResult.savings?.equityReleaseAnalysis && (
                <Card className="border-2 border-purple-500 bg-gradient-to-br from-purple-50 to-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-purple-600" />
                      💰 ניתוח הלוואה לכל מטרה (איחוד חובות)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* 📊 בלוק 6: מודול פיצול ואיחוד (Split & Consolidation) */}
                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        className="bg-white border-2 border-blue-500 rounded-xl p-6"
                      >
                        <div className="text-center mb-6">
                          <h3 className="font-bold text-blue-900 text-2xl mb-2">🔍 הפרדה אסטרטגית - מה באמת קורה?</h3>
                          <p className="text-sm text-slate-600">המשכנתא "גדלה", אבל הריבית הממוצעת נשארת הגיונית</p>
                        </div>

                        {/* 🎨 ויזואליזציה דרמטית: לפני ואחרי */}
                        <div className="grid md:grid-cols-2 gap-6 mb-8">
                          {/* 🔴 לפני */}
                          <motion.div
                            initial={{ x: -50, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-400 rounded-2xl p-6 relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-300 rounded-full opacity-20 -mr-16 -mt-16"></div>
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center">
                                  <span className="text-white text-2xl">❌</span>
                                </div>
                                <div>
                                  <p className="font-bold text-red-900 text-lg">לפני המהלך</p>
                                  <p className="text-xs text-red-700">מצב תזרימי קשה</p>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div className="bg-white/50 rounded-lg p-3 border border-red-200">
                                  <p className="text-xs text-red-800 mb-1">משכנתא קיימת</p>
                                  <p className="text-lg font-bold text-red-900">₪{analysisResult.currentLoan.monthlyPayment.toLocaleString()}</p>
                                </div>
                                {analysisResult.savings.equityReleaseAnalysis.externalDebts.map((debt, i) => (
                                  <div key={i} className="bg-white/50 rounded-lg p-3 border border-red-200">
                                    <p className="text-xs text-red-800 mb-1">{debt.creditor}</p>
                                    <p className="text-sm font-bold text-red-900">₪{debt.monthly_repayment.toLocaleString()} ({debt.estimated_interest}%)</p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 pt-4 border-t-2 border-red-300">
                                <p className="text-xs text-red-700 mb-1">סך הכל יוצא מהעו"ש:</p>
                                <p className="text-4xl font-black text-red-600">
                                  ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.beforeTotal.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </motion.div>

                          {/* 🟢 אחרי */}
                          <motion.div
                            initial={{ x: 50, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-400 rounded-2xl p-6 relative overflow-hidden"
                          >
                            <div className="absolute top-0 left-0 w-32 h-32 bg-green-300 rounded-full opacity-20 -ml-16 -mt-16"></div>
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                                  <span className="text-white text-2xl">✓</span>
                                </div>
                                <div>
                                  <p className="font-bold text-green-900 text-lg">אחרי המהלך</p>
                                  <p className="text-xs text-green-700">תזרים בריא ויציב</p>
                                </div>
                              </div>
                              <div className="bg-white/70 rounded-lg p-4 border border-green-200 mb-4">
                                <p className="text-xs text-green-800 mb-2">משכנתא מאוחדת אחת</p>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-slate-600">חלק דיור ({analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.rate}%)</span>
                                  <span className="font-semibold text-green-800">₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.monthlyImpact.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-slate-600">חלק לכל מטרה ({analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.rate}%)</span>
                                  <span className="font-semibold text-purple-700">₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.monthlyImpact.toLocaleString()}</span>
                                </div>
                              </div>
                              <div className="mt-4 pt-4 border-t-2 border-green-300">
                                <p className="text-xs text-green-700 mb-1">תשלום חודשי חדש:</p>
                                <p className="text-4xl font-black text-green-600">
                                  ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        </div>

                        {/* 📊 טבלת פירוט מקצועית */}
                        <div className="bg-slate-50 rounded-xl p-4 mb-6">
                          <h4 className="font-bold text-slate-900 mb-3 text-center">📋 פירוט רכיבי המימון</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-blue-50 border-b-2 border-blue-200">
                                  <th className="text-right py-3 px-4 font-bold text-blue-900">רכיב</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">סכום</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">ריבית</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">החזר חודשי</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b border-slate-200 hover:bg-green-50/50 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-slate-900">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.label}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-green-700">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.amount.toLocaleString()}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-blue-600">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.rate}%
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-slate-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.monthlyImpact.toLocaleString()}
                                  </td>
                                </tr>
                                <tr className="border-b border-slate-200 hover:bg-purple-50/50 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-slate-900">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.label}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-purple-700">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.amount.toLocaleString()}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-purple-600">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.rate}%
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-slate-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.monthlyImpact.toLocaleString()}
                                  </td>
                                </tr>
                                <tr className="bg-gradient-to-r from-blue-100 to-purple-100 border-t-2 border-blue-300">
                                  <td className="py-4 px-4 font-bold text-blue-900">סה"כ משכנתא חדשה</td>
                                  <td className="text-center py-4 px-4 font-black text-blue-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalPrincipal.toLocaleString()}
                                  </td>
                                  <td className="text-center py-4 px-4 font-bold text-blue-700">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.weightedRate}%
                                    <div className="text-xs text-blue-600 font-normal">(ממוצע משוקלל)</div>
                                  </td>
                                  <td className="text-center py-4 px-4 font-black text-blue-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 💥 שורת המחץ - מהפך תזרימי */}
                        <motion.div 
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.6, type: "spring" }}
                          className="bg-gradient-to-r from-green-100 via-emerald-100 to-teal-100 border-3 border-green-500 rounded-2xl p-6 shadow-xl"
                        >
                          <div className="text-center space-y-3">
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-full mb-2">
                              <TrendingUp className="w-5 h-5" />
                              <span className="font-bold">מהפך תזרימי</span>
                            </div>
                            <p className="text-base text-slate-900 leading-relaxed">
                              <strong className="text-red-700">לפני:</strong> שילמתם{' '}
                              <span className="font-black text-red-800 text-2xl inline-block px-2 py-1 bg-red-200 rounded">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.beforeTotal.toLocaleString()}
                              </span>{' '}
                              על כל החובות
                            </p>
                            <div className="flex items-center justify-center gap-3 my-4">
                              <div className="h-1 w-20 bg-gradient-to-r from-red-500 to-green-500"></div>
                              <span className="text-3xl">→</span>
                              <div className="h-1 w-20 bg-gradient-to-r from-green-500 to-emerald-500"></div>
                            </div>
                            <p className="text-base text-slate-900 leading-relaxed">
                              <strong className="text-green-700">אחרי איחוד ב"מיקוד":</strong> תשלום אחד של{' '}
                              <span className="font-black text-green-800 text-2xl inline-block px-2 py-1 bg-green-200 rounded">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                              </span>
                            </p>
                            <div className="pt-4 border-t-2 border-green-400 mt-4">
                              <p className="text-sm text-slate-700 mb-2">💰 תוספת נטו לעו"ש בכל חודש:</p>
                              <p className="text-5xl font-black text-green-600 animate-pulse">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.netSavings.toLocaleString()}
                              </p>
                              <p className="text-xs text-slate-600 mt-2">זה הכסף שנשאר לך לחיים!</p>
                            </div>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                    <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4">
                      <h3 className="font-bold text-purple-900 mb-3">🎯 המצב הנוכחי שלך</h3>
                      <div className="grid md:grid-cols-3 gap-4">
                        <div className="bg-white rounded-lg p-3">
                          <p className="text-xs text-slate-600 mb-1">משכנתא נוכחית</p>
                          <p className="text-lg font-bold text-slate-900">₪{analysisResult.savings.equityReleaseAnalysis.currentMortgageBalance.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border-2 border-red-300">
                          <p className="text-xs text-red-700 mb-1">חובות חיצוניים (בנקים/מינוס)</p>
                          <p className="text-lg font-bold text-red-600">₪{analysisResult.savings.equityReleaseAnalysis.totalExternalDebt.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border-2 border-blue-300">
                          <p className="text-xs text-blue-700 mb-1">שווי הנכס</p>
                          <p className="text-lg font-bold text-blue-600">₪{analysisResult.savings.equityReleaseAnalysis.propertyValue.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                        <h4 className="font-bold text-red-900 mb-2">❌ לפני - תזרים יוצא חודשי</h4>
                        <p className="text-3xl font-bold text-red-600 mb-3">₪{analysisResult.savings.equityReleaseAnalysis.currentMonthlyBurden.toLocaleString()}</p>
                        <div className="text-xs text-red-800 space-y-1">
                          <p>• משכנתא: ₪{analysisResult.currentLoan.monthlyPayment.toLocaleString()}</p>
                          {analysisResult.savings.equityReleaseAnalysis.externalDebts.map((debt, i) => (
                            <p key={i}>• {debt.creditor}: ₪{debt.monthly_repayment.toLocaleString()} ({debt.estimated_interest}%)</p>
                          ))}
                        </div>
                      </div>

                      <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4">
                        <h4 className="font-bold text-green-900 mb-2">✅ אחרי - תשלום חודשי אחד</h4>
                        <p className="text-3xl font-bold text-green-600 mb-3">₪{analysisResult.savings.equityReleaseAnalysis.newMonthlyPayment.toLocaleString()}</p>
                        <div className="text-xs text-green-800 space-y-1">
                          <p>• ריבית משוערת: {analysisResult.savings.equityReleaseAnalysis.allPurposeRate}%</p>
                          <p>• פריסה: 20 שנה</p>
                          <p>• כל החובות מאוחדים למשכנתא אחת</p>
                        </div>
                      </div>
                    </div>

                    <div className={`rounded-xl p-6 text-center ${
                      analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 
                        ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-400' 
                        : 'bg-gradient-to-r from-red-100 to-orange-100 border-2 border-red-400'
                    }`}>
                      <p className="text-sm font-semibold mb-2">🚀 שיפור תזרים חודשי</p>
                      <p className={`text-5xl font-black ${
                        analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 ? '+' : ''}
                        ₪{Math.abs(analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-700 mt-2">
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 
                          ? 'כסף נוסף לעו״ש שלך בכל חודש!' 
                          : 'שים לב: התשלום החודשי יגדל'}
                      </p>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-blue-600" />
                        <h4 className="font-bold text-blue-900">📊 אחוז מימון (LTV)</h4>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 bg-slate-200 rounded-full h-4">
                          <div 
                            className={`h-4 rounded-full transition-all ${
                              analysisResult.savings.equityReleaseAnalysis.status === 'HEALTHY_LTV' ? 'bg-green-500' :
                              analysisResult.savings.equityReleaseAnalysis.status === 'MODERATE_LTV' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`}
                            style={{width: `${Math.min(analysisResult.savings.equityReleaseAnalysis.ltvRatio, 100)}%`}}
                          />
                        </div>
                        <span className="font-bold text-2xl text-blue-900">{analysisResult.savings.equityReleaseAnalysis.ltvRatio}%</span>
                      </div>
                      <p className="text-xs text-blue-800 mt-2">
                        {analysisResult.savings.equityReleaseAnalysis.status === 'HEALTHY_LTV' && '✅ בטווח בריא (עד 50%) - סיכוי גבוה לאישור'}
                        {analysisResult.savings.equityReleaseAnalysis.status === 'MODERATE_LTV' && '⚠️ בטווח בינוני (50-70%) - דורש חיתום מדוקדק'}
                        {analysisResult.savings.equityReleaseAnalysis.status === 'HIGH_RISK_LTV' && '🚨 LTV גבוה (מעל 70%) - סיכוי נמוך לאישור'}
                      </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                      <p className="text-sm text-amber-900 leading-relaxed">
                        💡 <strong>חשוב לדעת:</strong> הלוואה לכל מטרה נושאת ריבית גבוהה יותר ממשכנתא רגילה (כ-{analysisResult.savings.equityReleaseAnalysis.allPurposeRate}% לעומת ~5% בדיור), 
                        אבל היא מאפשרת לך לשחרר את הנכס שלך ולסגור חובות יקרים (כרטיסי אשראי, מינוס וכו'). 
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 2000 && 
                          ` במקרה שלך, התזרים משתפר ב-₪${analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement.toLocaleString()} בחודש - זה יכול לשנות את איכות החיים שלך!`
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 🔥 נזק מדד - מועבר לתוך הניתוח המעמיק */}
              <AnimatePresence>
                {showAdvancedAnalysis && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-6 mt-6"
                  >
                    {analysisResult.savings?.indexDamageAlerts?.length > 0 && (
                      <Card className="glass-card border-2 border-red-500/40 bg-gradient-to-br from-red-950/30 to-[#172A45]">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-red-400">
                            <AlertCircle className="w-5 h-5" />
                            🔥 נזק המדד - כמה כסף "נשרף" בגלל ההצמדה
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-[#8892B0]">המסלולים הצמודים למדד גורמים לתשלום נוסף שאינו נראה בתשלום החודשי הנוכחי:</p>
                          {analysisResult.savings.indexDamageAlerts.map((alert, i) => (
                            <div key={i} className="glass-card rounded-lg p-3 border border-red-500/20">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-white">{alert.track_type}</span>
                                <span className="text-2xl font-black text-red-400">+₪{alert.indexDamage?.toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-red-300/80 mt-1">{alert.note}</p>
                            </div>
                          ))}
                          <div className="glass-card rounded-lg p-3 border-2 border-red-500/40 text-center">
                            <p className="text-sm font-bold text-white">סך נזק המדד הכולל:</p>
                            <p className="text-3xl font-black text-red-400">
                              +₪{analysisResult.savings.indexDamageAlerts.reduce((s, a) => s + (a.indexDamage || 0), 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-red-300/80 mt-1">💡 המחזור יבטל את ה"הצמדה" הזו לחלוטין ויחסוך גם כסף זה!</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-6 mt-8">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-white mb-2">3 תמהילי מחזור מומלצים</h2>
                  <p className="text-[#8892B0]">בחר את התמהיל המתאים לך ביותר</p>
                </div>

                <div className={`grid gap-4 ${analysisResult.mixes?.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
                  {analysisResult.mixes?.filter(Boolean).map((mix) => {
                    const riskConfig = ({
                      conservative: { label: 'שמרני', icon: '🛡️', accent: '#A8B5C8', accentBg: 'rgba(168,181,200,0.12)', desc: 'מינימום סיכון, יציבות מלאה' },
                      balanced:     { label: 'מאוזן',  icon: '⚖️', accent: '#C5A059', accentBg: 'rgba(197,160,89,0.12)',  desc: 'האיזון הטוב בין ריבית וסיכון' },
                      aggressive:   { label: 'אגרסיבי',icon: '🚀', accent: '#D4AF37', accentBg: 'rgba(212,175,55,0.12)',  desc: 'ריבית נמוכה, גמישות גבוהה' },
                    }[mix.risk_level]) ?? { label: 'מותאם', icon: '✦', accent: '#C5A059', accentBg: 'rgba(197,160,89,0.1)', desc: '' };

                    const isRecommended = mix.mix_number === 2;
                    const periodYears = mix.tracks?.[0]?.period_years || Math.round((mix.tracks?.reduce((s,t) => s + (t.period_years||0) * (t.percentage||0), 0) / 100)) || 20;
                    const trackColors = ['#C5A059', '#6B8CAE', '#D4AF37', '#8BA888'];

                    return (
                      <div key={mix.mix_number} className="relative flex flex-col rounded-2xl overflow-hidden"
                        style={{ 
                          background: 'linear-gradient(160deg, #0F2442 0%, #0A192F 100%)',
                          border: isRecommended ? '2px solid #C5A059' : '1px solid rgba(197,160,89,0.25)',
                          boxShadow: isRecommended ? '0 0 30px rgba(197,160,89,0.15), 0 8px 32px rgba(0,0,0,0.4)' : '0 4px 24px rgba(0,0,0,0.3)'
                        }}>

                        {/* תג מומלץ */}
                        {isRecommended && (
                          <div className="absolute top-0 left-0 right-0 text-center py-2 text-xs font-black tracking-widest uppercase"
                            style={{ background: 'linear-gradient(90deg, #B8922A, #D4AF37, #B8922A)', color: '#0A192F', letterSpacing: '0.15em' }}>
                            ⭐ המומלץ עבורך
                          </div>
                        )}

                        <div className={`p-5 ${isRecommended ? 'pt-10' : 'pt-5'}`}>
                          {/* כותרת + רמת סיכון */}
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-base">{riskConfig.icon}</span>
                                <span className="text-xs font-bold tracking-wider uppercase" style={{ color: riskConfig.accent }}>{riskConfig.label}</span>
                              </div>
                              <h3 className="text-lg font-black text-white leading-tight">{mix.mix_name}</h3>
                              <p className="text-xs text-slate-400 mt-0.5">{riskConfig.desc}</p>
                            </div>
                            <div className="text-left">
                              <p className="text-xs text-slate-500">תקופה</p>
                              <p className="text-lg font-black text-white">{periodYears}<span className="text-xs font-normal text-slate-400 mr-0.5">שנ'</span></p>
                            </div>
                          </div>

                          {/* החזר חודשי — מרכז הכרטיס */}
                          <div className="rounded-xl p-4 mb-4 text-center" style={{ background: riskConfig.accentBg, border: `1px solid ${riskConfig.accent}30` }}>
                            <p className="text-xs text-slate-400 mb-1">החזר חודשי חדש</p>
                            <p className="text-xl md:text-3xl font-black text-white">₪{mix.total_monthly_payment?.toLocaleString()}</p>
                            {mix.monthly_savings > 0 && (
                              <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: 'rgba(134,166,134,0.15)', border: '1px solid rgba(134,166,134,0.35)' }}>
                                <span className="text-xs font-bold" style={{ color: '#86A686' }}>חיסכון חודשי: ₪{mix.monthly_savings?.toLocaleString()}</span>
                              </div>
                            )}
                          </div>

                          {/* חיסכון כולל */}
                          {mix.net_savings > 0 && (
                            <div className="rounded-xl p-3 mb-4 text-center" style={{ background: 'rgba(134,166,134,0.08)', border: '1px solid rgba(134,166,134,0.2)' }}>
                              <p className="text-xs text-slate-400 mb-0.5">חיסכון כולל לאורך כל התקופה</p>
                              <p className="text-lg md:text-2xl font-black" style={{ color: '#86A686' }}>₪{mix.net_savings.toLocaleString()}</p>
                            </div>
                          )}

                          {/* פירוט מסלולים */}
                          <div className="space-y-2 mb-4">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">פירוט מסלולים</p>
                            {mix.tracks?.map((track, i) => (
                              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: trackColors[i % trackColors.length] }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-white font-semibold truncate">{track.track_type}</p>
                                  <p className="text-xs text-slate-500">{track.period_years ? `${track.period_years} שנים` : ''}</p>
                                </div>
                                <div className="text-left flex-shrink-0">
                                  <p className="text-sm font-black text-white">{track.interest_rate?.toFixed(2)}%</p>
                                  <p className="text-xs text-slate-500">{track.percentage}% מהסכום</p>
                                </div>
                                {track.amount > 0 && (
                                  <div className="text-left flex-shrink-0 mr-1">
                                    <p className="text-xs font-bold" style={{ color: riskConfig.accent }}>₪{Math.round(track.amount).toLocaleString()}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* יתרונות */}
                          {mix.advantages?.length > 0 && (
                            <div className="space-y-1.5 pt-3" style={{ borderTop: '1px solid rgba(197,160,89,0.15)' }}>
                              {mix.advantages.slice(0, 2).map((adv, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-slate-400">
                                  <span className="flex-shrink-0 mt-0.5" style={{ color: riskConfig.accent }}>✓</span>
                                  <span>{adv}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/*
                הוסר זמנית: כרטיס "המשך לתהליך מחזור מלא" (הפניה ל-ClientWorkflow).
                כרגע העמוד הזה מיועד ישירות ללקוחות קצה ולא לבנקים, ולכן אין צורך
                להמשיך אוטומטית לתהליך ליווי/הגשה מול הבנק בשלב הזה.
                לא נמחק — ייתכן שנצטרך להחזיר את זה כשנפתח את התהליך המלא ללקוחות.

              <Card className="border-2 border-[#C5A059] bg-gradient-to-br from-[#172A45] to-[#0A192F] mt-8 shadow-2xl">
                <CardContent className="p-8 text-center">
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-[#D4AF37]/20 rounded-full flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-[#D4AF37]" />
                    </div>
                    <h3 className="text-2xl font-black text-white">{analysisResult.savings.isWorthwhile ? 'מחזור משתלם! בוא נמשיך!' : 'רוצה לבדוק אפשרויות נוספות?'}</h3>
                  </div>
                  <p className="text-[#8892B0] mb-8 text-lg">
                    {analysisResult.savings.isWorthwhile
                      ? 'נלווה אותך בתהליך המחזור המלא - מהגשה לבנקים ועד לחתימה'
                      : 'תוכל להתחיל תהליך וליצור תיק - נעקוב אחרי השוק ונודיע לך כשיהיה משתלם'}
                  </p>
                  <div className="flex flex-wrap gap-4 justify-center">
                    <Link to={createPageUrl('ClientWorkflow')} onClick={() => {
                      // Map to the same format QuickDocCheck uses
                      const reportData = analysisResult;
                      const dataToStore = {
                        ...reportData,
                        borrower_2: reportData.borrower_2 || null,
                        // Fields that ClientWorkflow expects from quickCheckResult
                        reportType: reportData.savings?.equityReleaseAnalysis ? 'מיחזור משכנתא ואיחוד חובות' : 'מחזור משכנתא',
                        detected_case_types: reportData.savings?.equityReleaseAnalysis ? ['מחזור משכנתא', 'מיחזור משכנתא ואיחוד חובות'] : ['מחזור משכנתא'],
                      };
                      localStorage.setItem('quickCheckResult', JSON.stringify(dataToStore));
                    }}>
                      <Button className="h-16 px-10 text-xl font-bold btn-gold text-[#0A192F]">
                        {analysisResult.savings.isWorthwhile ? 'התחל תהליך מחזור מלא' : 'פתח תיק לעקיבה'}
                        <ChevronLeft className="w-6 h-6 mr-2" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
              */}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}