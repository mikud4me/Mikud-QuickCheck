import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import PillarBreakdown from '../components/underwriter/PillarBreakdown';
import IdentityLockPanel from '../components/underwriter/IdentityLockPanel';
import ExecutiveAlertsPanel from '../components/underwriter/ExecutiveAlertsPanel';
import ActionBar from '../components/underwriter/ActionBar';
import UnderwriterKPIHeader from '../components/underwriter/UnderwriterKPIHeader';
import { Loader2, AlertTriangle, Upload, FolderOpen, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AsyncDocumentUpload from '../components/underwriter/AsyncDocumentUpload';
import { useUnderwriterPolling } from '../components/underwriter/useUnderwriterPolling';
import BackgroundProcessingScreen from '../components/underwriter/BackgroundProcessingScreen';
import { toast } from 'sonner';
import DocumentsVerificationPanel from '../components/underwriter/DocumentsVerificationPanel';
import InternalNotes from '../components/underwriter/InternalNotes';
import AuditLogPanel from '../components/underwriter/AuditLogPanel';
import ScoreHeroBanner from '../components/underwriter/ScoreHeroBanner';
import RefinanceComparisonTable from '../components/underwriter/RefinanceComparisonTable';
import ChecklistPanel from '../components/underwriter/ChecklistPanel';
import ShadowDebtValidator from '../components/underwriter/ShadowDebtValidator';
import LiabilityBreakdownTable from '../components/underwriter/LiabilityBreakdownTable';
import ExecutiveSummaryBanner from '../components/underwriter/ExecutiveSummaryBanner';
import AIExecutiveSummaryCard from '../components/underwriter/AIExecutiveSummaryCard';
import PrintableSubmissionPackage from '../components/underwriter/PrintableSubmissionPackage';
import { shouldForceReanalysis } from '../components/underwriter/cacheValidityChecks';

export default function UnderwriterDashboard() {
  const navigate = useNavigate();
  const [scoreObject, setScoreObject] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [caseId, setCaseId] = useState(null);
  const [caseData, setCaseData] = useState(null);
  const [caseDocuments, setCaseDocuments] = useState([]); // DB Document entity records with file_url
  const [processingCaseId, setProcessingCaseId] = useState(null);
  const [showPrintPackage, setShowPrintPackage] = useState(false);
  const topRef = useRef(null);
  const hasRequestedSummary = useRef(false);

  // ── Polling: עוקב אחר תיק שבעיבוד ברקע עד שמוכן ──
  useUnderwriterPolling(processingCaseId, {
    enabled: !!processingCaseId,
    onComplete: (c) => {
      setProcessingCaseId(null);
      setCaseData(c);
      setCaseId(c.id);
      setScoreObject(c.score_data);
      supabase.from('documents').select('*').eq('case_id', c.id).then(({ data: docs }) => setCaseDocuments(docs || []));
      toast.success('הדוח החיתומי מוכן ✓', { description: `תיק ${c.case_number} עבר ניתוח מלא`, duration: 6000 });
    },
    onFailed: (msg) => {
      setProcessingCaseId(null);
      setError(msg);
      toast.error('העיבוד נכשל', { description: msg });
    }
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    // ── ניקוי זיכרון: בכל כניסה לעמוד — מתחילים מאפס ──
    setScoreObject(null);
    setCaseData(null);
    setError(null);
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('caseId');
    if (id) {
      setCaseId(id);
      loadCaseAndAnalyze(id);
    } else {
      setCaseId(null);
    }
  }, []);

  const loadCaseAndAnalyze = async (id, forceReanalyze = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: caseRecord } = await supabase.from('mortgage_cases').select('*').eq('id', id).single();
      if (!caseRecord) throw new Error('תיק לא נמצא');
      setCaseData(caseRecord);
      // Load Document records for the appendix (they have the real file_url)
      supabase.from('documents').select('*').eq('case_id', id).then(({ data: docs }) => {
        console.log('[UnderwriterDashboard] Document records loaded:', docs?.length, docs?.map(d => ({ type: d.document_type, url: d.file_url?.substring(0, 60) })));
        setCaseDocuments(docs || []);
      });

      // ── תיק שעדיין בעיבוד ברקע — עוברים לפולינג במקום לחכות סינכרונית ──
      // (מונע 502 על תיקים גדולים שטרם סיימו את ה-Worker)
      if (caseRecord.case_status === 'processing') {
        setIsLoading(false);
        setProcessingCaseId(id);
        return;
      }

      // Format 1: score_data field (new format) — skip if force reanalyze
      if (!forceReanalyze && caseRecord.score_data?.kpi) {
        const cachedScore = caseRecord.score_data;
        // ✅ HARD OVERRIDE: אם ה-Guard Clause של Identity Lock הפעיל קנס ל-40 בקאש
        // למרות שה-idCardVerified pipeline כבר תוקן — נכריח re-analysis כדי שהדוח החדש
        // ישתמש בלוגיקה המתוקנת ולא יחזיר ציון D מהקאש הישן.
        if (shouldForceReanalysis(cachedScore)) {
          console.log('Cache invalidation triggered — forcing re-analysis (identity lock / bug fix)');
          supabase.from('mortgage_cases').update({ score_data: null }).eq('id', id).then(() => {});
        } else {
          setScoreObject(cachedScore);
          setIsLoading(false);
          return;
        }
      }

      // Format 2: legacy — scoreObject saved in notes as JSON string
      let normalizedData = null;
      if (caseRecord.notes) {
        try {
          const parsed = JSON.parse(caseRecord.notes);
          if (parsed?.kpi && parsed?.riskAnalysis) {
            setScoreObject(parsed);
            supabase.from('mortgage_cases').update({ score_data: parsed }).eq('id', id).then(() => {});
            setIsLoading(false);
            return;
          }
          // quickCheckAnalysis stores the buildQuickReport OUTPUT (borrower_info, risk_radar, etc.)
          // The actual normalizedData is nested inside it — try to find it
          if (parsed?.quickCheckAnalysis) {
            const qca = parsed.quickCheckAnalysis;
            // Try to find actual normalized mortgage data (has borrowers array)
            normalizedData = qca.rawData || qca.normalizedData || null;
            // If not found, check if it has borrowers directly (normalizeDocData output)
            if (!normalizedData && qca.borrowers) normalizedData = qca;
          }
          if (!normalizedData && parsed?.normalizedData) normalizedData = parsed.normalizedData;
          if (!normalizedData && parsed?.borrowers) normalizedData = parsed;
        } catch (e) { /* ignore */ }
      }

      if (!normalizedData) {
        // No raw normalized data found — this case was created from QuickDocCheck
        // or has no extractable data. Show empty state with upload option.
        console.log('UnderwriterDashboard: no normalizedData found — showing upload state');
        setIsLoading(false);
        return;
      }

      // Safety check: normalizedData must look like actual mortgage data (not buildQuickReport output)
      // buildQuickReport output has borrower_info, risk_radar etc. — NOT the raw borrowers array
      if (normalizedData.borrower_info && !normalizedData.borrowers) {
        console.log('UnderwriterDashboard: normalizedData appears to be buildQuickReport output, not raw data — showing upload state');
        setIsLoading(false);
        return;
      }

      const caseType = caseRecord.case_type === 'refinance' ? 'refinance' : 'mortgage';
      const { data: scoreData, error: reportError } = await supabase.functions.invoke('buildUnderwriterReport', {
        body: {
          normalizedData,
          caseType,
          proposedMonthlyPayment: caseRecord.refinance_savings?.newMonthlyPayment || 0
        }
      });
      // supabase.functions.invoke() resolves { data, error } on a non-2xx
      // response rather than throwing (unlike Base44's axios-shaped SDK) — throw
      // explicitly here so the existing catch-block's timeout/fallback routing
      // below still triggers on a 502/504 the same way it did originally.
      if (reportError) throw reportError;

      setScoreObject(scoreData);

      // Auto-save scoreObject to score_data so Lobby shows it as analyzed
      try {
        const { error: saveErr } = await supabase.from('mortgage_cases').update({
          score_data: scoreData,
          analysis_timestamp: new Date().toISOString(),
        }).eq('id', id);
        if (saveErr) throw saveErr;
      } catch (saveErr) {
        console.warn('Could not auto-save score:', saveErr);
      }
    } catch (err) {
      const status = err?.context?.status;
      const msg = err?.message || '';
      // 502/504/timeout בקריאה הסינכרונית = התיק כבד מדי לעיבוד מיידי.
      // מנתבים אותו ל-Worker האסינכרוני ועוברים לפולינג במקום להציג שגיאה.
      const isTimeout = status === 502 || status === 504 || /502|504|timeout|network/i.test(msg);
      if (isTimeout) {
        try {
          const { error: statusErr } = await supabase.from('mortgage_cases').update({ case_status: 'processing' }).eq('id', id);
          if (statusErr) throw statusErr;
          supabase.functions.invoke('processUnderwriterCase', { body: { caseId: id, wizardData: {} } }).catch(() => {});
          setIsLoading(false);
          setProcessingCaseId(id);
          return;
        } catch (_) { /* נופל לשגיאה הרגילה */ }
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileAnalyze = (scoreData, newCaseId) => {
    setScoreObject(scoreData);
    if (newCaseId) setCaseId(newCaseId);
  };

  // ── Executive Summary — נוצר אסינכרונית לאחר טעינת הדוח (Anti-Loop Guard) ──
  useEffect(() => {
    if (!scoreObject?.kpi || scoreObject?.executive_summary) return;
    if (hasRequestedSummary.current) return;
    hasRequestedSummary.current = true; // נועל מיד — אפילו אם ה-API נכשל לא ננסה שוב

    const fetchSummary = async () => {
      try {
        const slim = {
          borrowers: [scoreObject.borrowers?.borrower1, scoreObject.borrowers?.borrower2]
            .filter(Boolean)
            .map(b => ({
              name: b.name, employment_type: b.employment_type, employer: b.employer,
              monthly_net_income: b.monthly_income, seniority_years: b.seniority_years
            })),
          total_income: scoreObject.kpi.verified_income,
          loans_monthly_total: scoreObject.kpi.total_liabilities,
          property_value: scoreObject.kpi.property_value,
          risk_score: scoreObject.kpi.risk_score,
          rating: scoreObject.kpi.rating,
          pti: scoreObject.kpi.pti_unified,
          ltv: scoreObject.kpi.ltv
        };
        const { data: helperData } = await supabase.functions.invoke('generateExecutiveSummaryHelper', { body: { slim } });
        const summary = helperData?.executive_summary;
        if (summary && summary.length > 50) {
          setScoreObject(prev => ({ ...prev, executive_summary: summary }));
        }
      } catch (err) {
        console.warn('Executive summary async fetch failed:', err);
      }
    };

    fetchSummary();
  }, [scoreObject?.kpi]);

  // Reset summary guard when loading a new case
  useEffect(() => {
    hasRequestedSummary.current = false;
  }, [caseId]);

  // גלילה לראש הדף ברגע שהדוח מוכן
  useEffect(() => {
    if (scoreObject) {
      // מצא את כל האלמנטים שגולל בהם וגלול לראש
      const resetAllScroll = () => {
        // 1. window
        window.scrollTo(0, 0);
        // 2. html + body
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        // 3. כל אלמנט שהוא scrollable container
        const allEls = document.querySelectorAll('*');
        allEls.forEach(el => {
          try {
            if (el.scrollTop !== 0) el.scrollTop = 0;
          } catch(e) {}
        });
      };
      // ריצה מיידית + כמה פעמים בפיגור כדי לתפוס render מאוחר
      resetAllScroll();
      setTimeout(resetAllScroll, 50);
      setTimeout(resetAllScroll, 200);
      setTimeout(resetAllScroll, 500);
    }
  }, [scoreObject]);



  return (
    <div className="min-h-screen bg-[#060b14]" dir="rtl">
      {/* Premium ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[#C5A059]/6 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[#1a3a6b]/25 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-[#C5A059]/3 rounded-full blur-3xl" />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(#C5A059 1px, transparent 1px), linear-gradient(90deg, #C5A059 1px, transparent 1px)',
            backgroundSize: '80px 80px'
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Scroll anchor */}
        <div ref={topRef} />

        {/* Header Bar */}
        <header className="border-b border-[#C5A059]/25 bg-[#060b14]/95 backdrop-blur-xl sticky top-0 z-50" style={{ boxShadow: '0 1px 30px rgba(197,160,89,0.08)' }}>
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                title="אין לובי חיתום בגרסה עצמאית זו — התיק היחיד שנוצר כאן הוא זה שבמעלה כרגע"
                className="flex items-center gap-1.5 text-[#8892B0] hover:text-[#C5A059] text-xs border border-[#1e2d4a] hover:border-[#C5A059]/40 px-3 py-1.5 rounded-lg transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                בית
              </button>
              <div className="w-8 h-8 rounded border border-[#C5A059]/40 flex items-center justify-center">
                <div className="w-3 h-3 bg-[#C5A059]" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} />
              </div>
              <div>
                <h1 className="text-white font-semibold tracking-widest text-sm">
                  מיקוד — מרכז חיתום מוסדי
                </h1>
                <p className="text-[#8892B0] text-xs">ניתוח סיכונים ואימות מסמכים</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#8892B0]">
              {caseData && (
                <span className="border border-[#C5A059]/30 px-3 py-1 rounded text-[#C5A059]">
                  תיק: {caseData.case_number || caseId?.slice(-6)}
                </span>
              )}
              <span className="opacity-40">{new Date().toLocaleDateString('he-IL')}</span>
            </div>
          </div>
        </header>

        <main className="max-w-[1400px] mx-auto px-6 py-8">

          {/* Empty state */}
          {!isLoading && !scoreObject && !error && !processingCaseId && (
            <EmptyState
              caseId={caseId}
              caseData={caseData}
              onLoadCase={(id) => { setCaseId(id); loadCaseAndAnalyze(id); }}
              onQueued={(newCaseId) => setProcessingCaseId(newCaseId)}
              onAnalysisComplete={(data, newCaseId) => {
                setScoreObject(data);
                if (newCaseId) { setCaseId(newCaseId); }
              }}
            />
          )}

          {/* Processing in background */}
          {processingCaseId && !scoreObject && (
            <BackgroundProcessingScreen onCancel={() => setProcessingCaseId(null)} />
          )}

          {/* Loading */}
          {isLoading && <AnalysisLoader />}

          {/* Error */}
          {error && (
            <div className="max-w-2xl mx-auto py-20">
              <div className="border border-red-500/30 bg-red-500/5 rounded-2xl p-8 text-center">
                <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" />
                <p className="text-white font-medium mb-2">שגיאה בטעינת הנתונים</p>
                <p className="text-[#8892B0] text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Dashboard */}
          {scoreObject && !isLoading && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* ── SCORE HERO BANNER ─────────────────────────────── */}
                <ScoreHeroBanner scoreObject={scoreObject} caseData={caseData} />

                {/* ── EXECUTIVE SUMMARY — אסטרטגיית החיתום שהמנוע בנה (פותר התיקים) ── */}
                <ExecutiveSummaryBanner kpi={scoreObject.kpi} />

                {/* ── AI EXECUTIVE SUMMARY — חוות דעת חיתומית איכותנית Post-Merge ── */}
                <AIExecutiveSummaryCard
                  summary={scoreObject.executive_summary}
                  onRegenerate={() => caseId && loadCaseAndAnalyze(caseId, true)}
                />

                {/* Refinance Impact Analysis — shown for refinance/debt_consolidation */}
                {scoreObject.refinanceImpact && (
                  <RefinanceComparisonTable
                    refinanceImpact={scoreObject.refinanceImpact}
                    caseType={scoreObject.case_type}
                  />
                )}

                {/* Manual Review Banner */}
                {scoreObject.kpi.requires_manual_review && (
                  <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <p className="text-amber-300 text-sm font-medium">
                        רמת ביטחון נמוכה ({scoreObject.kpi.confidence_level}%) — נדרשת בדיקה אנושית ידנית
                      </p>
                    </div>
                    <span className="text-xs text-amber-500 border border-amber-500/40 px-3 py-1 rounded">
                      נדרשת בדיקה ידנית
                    </span>
                  </div>
                )}

                {/* ROW 1: KPI Header */}
                <UnderwriterKPIHeader kpi={scoreObject.kpi} borrowers={scoreObject.borrowers} scoreObject={scoreObject} />

                {/* ROW 2: Pillar Breakdown + Identity Lock */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
                  <PillarBreakdown riskAnalysis={scoreObject.riskAnalysis} />
                  <IdentityLockPanel identityVerification={scoreObject.identityVerification} />
                </div>

                {/* ROW 2.5: Liability Breakdown — פירוט כל ההתחייבויות (קריטי למחזור/איחוד) */}
                {(scoreObject.kpi?.liability_breakdown?.length > 0 || scoreObject.kpi?.proactive_solution) && (
                  <LiabilityBreakdownTable kpi={scoreObject.kpi} caseType={scoreObject.case_type} />
                )}

                {/* ROW 3: Executive Alerts */}
                <ExecutiveAlertsPanel
                  alerts={scoreObject.executiveAlerts}
                  borrowers={scoreObject.borrowers}
                />

                {/* ROW 4: Shadow Debt Validator */}
                {scoreObject.shadowDebts && scoreObject.shadowDebts.length > 0 && (
                  <ShadowDebtValidator
                    shadowDebts={scoreObject.shadowDebts}
                    totalNetIncome={scoreObject.kpi?.verified_income || 0}
                    proposedPayment={scoreObject.kpi?.pti_with_proposed != null
                      ? Math.round((scoreObject.kpi.pti_unified / 100) * scoreObject.kpi.verified_income)
                      : 0}
                    currentLoansTotal={scoreObject.kpi?.total_liabilities || 0}
                  />
                )}

                {/* ROW 5: Checklist Sync */}
                {scoreObject.checklist && (
                    <ChecklistPanel checklist={scoreObject.checklist} />
                )}

                {/* ROW 5: Document Verification — הלב של הדוח */}
                {scoreObject.documents && scoreObject.documents.length > 0 && (
                  <DocumentsVerificationPanel documents={scoreObject.documents} />
                )}

                {/* ROW 5: Action Bar */}
                <ActionBar
                  scoreObject={scoreObject}
                  caseId={caseId}
                  borrowers={scoreObject.borrowers}
                  onReload={() => caseId && loadCaseAndAnalyze(caseId, true)}
                  onReset={() => { setScoreObject(null); setCaseId(null); setCaseData(null); }}
                  onPrint={() => setShowPrintPackage(true)}
                />

                {/* ROW 6: Internal Notes + Audit Log (admin only, caseId required) */}
                {caseId && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <InternalNotes caseId={caseId} />
                    <AuditLogPanel caseId={caseId} />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* Printable Submission Package Modal */}
      {showPrintPackage && scoreObject && (
        <PrintableSubmissionPackage
          scoreObject={scoreObject}
          caseData={{ ...caseData, documents: caseDocuments.length > 0 ? caseDocuments : (caseData?.documents || []) }}
          onClose={() => setShowPrintPackage(false)}
        />
      )}
    </div>
  );
}

// ─── Analysis Loader — Luxury progress screen ────────────────────────────────
function AnalysisLoader() {
  const [step, setStep] = useState(0);
  const steps = [
    { label: 'קורא מסמכים ומחלץ נתונים', sub: 'OCR · תלושי שכר · דפי בנק · שומות' },
    { label: 'מאמת זהות לווים', sub: 'השוואת ת.ז מול תלושים ועו"ש · Triple-Lock' },
    { label: 'מחשב ציוני סיכון', sub: 'PTI · LTV · BDI · ויציבות תעסוקתית' },
    { label: 'מזהה דגלים אדומים וגורמים מפצים', sub: 'ניתוח תנועות חריגות · שבתון · עצמאים' },
    { label: 'מגבש המלצת חיתום', sub: 'דירוג סופי · רמת ביטחון · סיכוי אישור' },
  ];

  useEffect(() => {
    const timers = steps.map((_, i) =>
      setTimeout(() => setStep(i + 1), i * 1400 + 600)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-0">
      {/* Central glow orb */}
      <div className="relative mb-14">
        <div className="absolute inset-[-60px] bg-[#C5A059]/6 rounded-full blur-3xl animate-pulse" />
        {/* Outer orbit */}
        <motion.div
          className="absolute inset-[-28px] rounded-full border border-[#C5A059]/15"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#C5A059]/60 shadow-[0_0_12px_#C5A059]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#C5A059]/30" />
        </motion.div>
        {/* Inner orbit */}
        <motion.div
          className="absolute inset-[-14px] rounded-full border border-[#C5A059]/25"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
        >
          <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#D4AF37]/70 shadow-[0_0_8px_#D4AF37]" />
        </motion.div>
        {/* Core */}
        <div className="relative w-20 h-20 rounded-2xl border border-[#C5A059]/50 bg-[#0d1524] flex items-center justify-center shadow-[0_0_30px_rgba(197,160,89,0.2)]">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <polygon points="16,2 30,28 2,28" stroke="#C5A059" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
              <polygon points="16,9 24,24 8,24" stroke="#C5A059" strokeWidth="1" fill="rgba(197,160,89,0.08)" strokeLinejoin="round"/>
            </svg>
          </motion.div>
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-10">
        <h2 className="text-white text-xl font-bold tracking-widest mb-1">מנוע החיתום פועל</h2>
        <p className="text-[#8892B0] text-sm tracking-[0.15em]">UNDERWRITING ENGINE · AI ANALYSIS</p>
      </div>

      {/* Steps */}
      <div className="w-full max-w-lg space-y-3 mb-10">
        {steps.map((s, i) => {
          const done = step > i;
          const active = step === i;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: done || active ? 1 : 0.2, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`flex items-start gap-4 px-5 py-3.5 rounded-xl border transition-all duration-500 ${
                done
                  ? 'border-[#C5A059]/30 bg-[#C5A059]/5'
                  : active
                  ? 'border-[#C5A059]/20 bg-[#0d1524]'
                  : 'border-[#1e2d4a] bg-transparent'
              }`}
            >
              {/* Status icon */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all duration-500 ${
                done ? 'bg-[#C5A059] border border-[#C5A059]' : 'border border-[#2a3a55]'
              }`}>
                {done
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="#0A0F1A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : active
                  ? <motion.div className="w-2 h-2 rounded-full bg-[#C5A059]" animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} />
                  : <div className="w-2 h-2 rounded-full bg-[#2a3a55]" />
                }
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium transition-colors ${done ? 'text-[#C5A059]' : active ? 'text-white' : 'text-[#3a4a65]'}`}>
                  {s.label}
                </p>
                <p className={`text-xs mt-0.5 transition-colors ${done || active ? 'text-[#8892B0]' : 'text-[#2a3a55]'}`}>
                  {s.sub}
                </p>
              </div>
              {done && (
                <span className="text-[10px] text-[#C5A059]/60 border border-[#C5A059]/20 px-1.5 py-0.5 rounded shrink-0">
                  הושלם
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-lg">
        <div className="flex justify-between text-xs text-[#4a5568] mb-2">
          <span>ניתוח בתהליך...</span>
          <span className="text-[#C5A059]">{Math.round((step / steps.length) * 100)}%</span>
        </div>
        <div className="h-1 bg-[#1e2d4a] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#C5A059] to-[#D4AF37]"
            animate={{ width: `${(step / steps.length) * 100}%` }}
            transition={{ duration: 0.5 }}
            style={{ boxShadow: '0 0 12px rgba(197,160,89,0.5)' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Empty State — Luxury landing ────────────────────────────────────────────
function EmptyState({ onLoadCase, onAnalysisComplete, onQueued, caseId, caseData }) {
  const [inputId, setInputId] = useState('');
  // If we arrived from a case that has no analysis data, go straight to upload mode
  const [mode, setMode] = useState(caseId ? 'upload' : null); // null | 'case' | 'upload'

  if (mode === 'upload') {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setMode(null)}
            className="text-[#8892B0] hover:text-[#C5A059] text-sm flex items-center gap-2 transition-colors"
          >
            ← חזור
          </button>
          {caseData && (
            <div className="text-right">
              <p className="text-[#C5A059] text-sm font-semibold">{caseData.primary_borrower?.full_name || 'תיק ללא שם'}</p>
              <p className="text-[#4a5568] text-xs">תיק {caseData.case_number} · העלה מסמכים לניתוח חיתום</p>
            </div>
          )}
        </div>
        <AsyncDocumentUpload
          wizardData={{ caseType: caseData?.case_type || 'mortgage' }}
          onQueued={onQueued}
          onBack={() => setMode(null)}
        />
      </div>
    );
  }

  const features = [
    { icon: '⚡', label: 'ניתוח AI מהיר', desc: 'מנוע חיתום מוסדי מבוסס בינה מלאכותית' },
    { icon: '🔐', label: 'אימות זהות משולש', desc: 'ת.ז · תלוש שכר · עו"ש — Triple Lock' },
    { icon: '📊', label: 'ציון סיכון מורכב', desc: '4 עמודי ניקוד · PTI · LTV · BDI · יציבות' },
    { icon: '🚨', label: 'דגלים אדומים', desc: 'זיהוי שבתון, חריגות הכנסה וסיכוני אשראי' },
  ];

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center relative" dir="rtl">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[#C5A059]/4 rounded-full blur-3xl" />
        {/* Grid lines */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(#C5A059 1px, transparent 1px), linear-gradient(90deg, #C5A059 1px, transparent 1px)',
            backgroundSize: '60px 60px'
          }}
        />
      </div>

      {/* Hero section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-14 relative z-10"
      >
        {/* Logo mark */}
        <div className="relative inline-flex items-center justify-center mb-8">
          <div className="absolute w-32 h-32 bg-[#C5A059]/10 rounded-full blur-2xl" />
          <div className="relative w-24 h-24 rounded-2xl border border-[#C5A059]/40 bg-[#0d1524] flex items-center justify-center shadow-[0_0_40px_rgba(197,160,89,0.15)]">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <polygon points="22,4 40,38 4,38" stroke="#C5A059" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
              <polygon points="22,13 33,34 11,34" stroke="#C5A059" strokeWidth="1" fill="rgba(197,160,89,0.1)" strokeLinejoin="round"/>
              <circle cx="22" cy="22" r="3" fill="#C5A059" opacity="0.6"/>
            </svg>
          </div>
        </div>

        <h1 className="text-4xl font-black text-white tracking-tight mb-3">
          מרכז חיתום מוסדי
        </h1>
        <p className="text-[#8892B0] text-lg max-w-xl mx-auto leading-relaxed">
          מערכת חיתום מוסדית מבוססת AI — ניתוח מקיף של תיקי משכנתאות,<br/>
          אימות זהות ומיפוי סיכונים בזמן אמת
        </p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400/80 text-xs tracking-widest">SYSTEM ONLINE · READY FOR ANALYSIS</span>
        </div>
      </motion.div>

      {/* Feature pills */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-12 w-full max-w-3xl relative z-10 px-4"
      >
        {features.map((f, i) => (
          <div key={i} className="bg-[#0d1524] border border-[#1e2d4a] rounded-xl p-4 text-center hover:border-[#C5A059]/30 transition-colors">
            <div className="text-2xl mb-2">{f.icon}</div>
            <p className="text-white text-xs font-bold mb-1">{f.label}</p>
            <p className="text-[#4a5568] text-[11px] leading-tight">{f.desc}</p>
          </div>
        ))}
      </motion.div>

      {/* CTA Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-2xl relative z-10 px-4"
      >
        {/* Upload card */}
        <button
          onClick={() => setMode('upload')}
          className="group relative border border-[#1e2d4a] hover:border-[#C5A059]/60 bg-[#0d1524] hover:bg-[#0d1524] rounded-2xl p-8 text-right transition-all duration-300 overflow-hidden"
          style={{ boxShadow: 'none' }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 40px rgba(197,160,89,0.12)'}
          onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
        >
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#C5A059]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-14 h-14 rounded-xl bg-[#C5A059]/10 border border-[#C5A059]/30 flex items-center justify-center mb-5 group-hover:bg-[#C5A059]/20 transition-colors">
            <Upload className="w-7 h-7 text-[#C5A059]" />
          </div>
          <p className="text-white font-bold text-lg mb-2">העלאת מסמכים</p>
          <p className="text-[#8892B0] text-sm leading-relaxed mb-5">
            העלה תלושי שכר, דפי בנק ושומות מס לניתוח AI מיידי
          </p>
          <div className="flex items-center gap-2 text-xs text-[#C5A059]">
            <span>ניתוח עצמאי מלא</span>
            <span>←</span>
          </div>
        </button>

        {/* Load case card */}
        <button
          onClick={() => setMode('case')}
          className="group relative border border-[#1e2d4a] hover:border-[#C5A059]/60 bg-[#0d1524] rounded-2xl p-8 text-right transition-all duration-300 overflow-hidden"
          style={{ boxShadow: 'none' }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 40px rgba(197,160,89,0.12)'}
          onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
        >
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#C5A059]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-14 h-14 rounded-xl bg-[#8892B0]/10 border border-[#8892B0]/20 flex items-center justify-center mb-5 group-hover:bg-[#C5A059]/10 group-hover:border-[#C5A059]/30 transition-all">
            <FolderOpen className="w-7 h-7 text-[#8892B0] group-hover:text-[#C5A059] transition-colors" />
          </div>
          <p className="text-white font-bold text-lg mb-2">טעינת תיק קיים</p>
          <p className="text-[#8892B0] text-sm leading-relaxed mb-5">
            הזן מזהה תיק שכבר עבר בדיקה מהירה ונמצא בלובי
          </p>
          <div className="flex items-center gap-2 text-xs text-[#8892B0] group-hover:text-[#C5A059] transition-colors">
            <span>מחייב Case ID</span>
            <span>←</span>
          </div>
        </button>
      </motion.div>

      {/* Case ID input */}
      {mode === 'case' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 flex items-center gap-3 w-full max-w-md relative z-10 px-4"
        >
          <input
            type="text"
            value={inputId}
            autoFocus
            onChange={e => setInputId(e.target.value)}
            placeholder="הדבק כאן את מזהה התיק (Case ID)"
            className="flex-1 bg-[#111827] border border-[#1e2d4a] focus:border-[#C5A059]/50 text-white rounded-xl px-4 py-3 text-sm outline-none placeholder:text-[#4a5568] transition-colors"
            onKeyDown={e => e.key === 'Enter' && inputId && onLoadCase(inputId)}
          />
          <button
            onClick={() => inputId && onLoadCase(inputId)}
            disabled={!inputId}
            className="px-6 py-3 bg-[#C5A059] hover:bg-[#D4AF37] disabled:opacity-40 text-[#0A0F1A] font-bold text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(197,160,89,0.3)]"
          >
            נתח
          </button>
        </motion.div>
      )}
    </div>
  );
}