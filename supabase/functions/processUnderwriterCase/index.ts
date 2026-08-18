import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { mergeExtractedDocuments as mergeExtractions } from "../_shared/mergeExtractedDocuments.js";

// ── TIMEOUT GUARD — prevents an infinite spinner ──
// If the worker doesn't finish within TIMEOUT_MS, update the DB to failed and
// return a clear error.
const TIMEOUT_MS = 145_000; // 145s — max possible under Deno's ~150s limit

/**
 * processUnderwriterCase — orchestrator for מרכז חיתום מוסדי.
 *
 * ── NO AUTH, BY EXPLICIT DECISION (2026-08-19) ──
 * This is the second port of מרכז חיתום מוסדי — unlike the first (gated
 * behind Supabase Auth + appMetadata.role='admin'), this copy has no login
 * at all, same as the rest of this app.
 * - asServiceRole.entities.MortgageCase.get/update → ctx.supabaseAdmin.from('mortgage_cases').
 * - asServiceRole.functions.invoke(...) → ctx.supabaseAdmin.functions.invoke(...).
 *   This function is itself called server-to-server too — by sweepStuckUnderwriterCases'
 *   cron re-invocation — so it accepts both "publishable" (direct calls from
 *   AsyncDocumentUpload) and "secret" (the cron caller, and this function's own
 *   downstream calls to normalizeDocData/lockEmployerFromPayslips/buildUnderwriterReport
 *   use the same pattern).
 * - extractDocData fallback branch (raw-file-urls, no client-side extraction) —
 *   DEFERRED, not ported (see project migration plan). Every call site in this
 *   repo (AsyncDocumentUpload) always supplies extractedResults, so this branch
 *   is unreachable in practice; stubbed to fail closed with a clear error
 *   instead of silently doing nothing, matching the original's own "no data"
 *   failure path.
 */
export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    let caseId = null;

    if (ctx.authMode === 'user' && ctx.userClaims?.appMetadata?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Hard timer — Promise.race between the work and the timeout.
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT_145')), TIMEOUT_MS);
    });

    try {
      const payload = await req.json();
      caseId = payload.caseId;
      let fileUrls = payload.fileUrls || [];
      let extractedResults = payload.extractedResults || null;
      let wizardData = payload.wizardData || {};
      let dealContext = payload.deal_context || null;

      if (!caseId) {
        clearTimeout(timeoutId);
        return Response.json({ error: 'caseId חובה' }, { status: 400 });
      }

      const workPromise = (async () => {
        // ── Fallback: pull from the record if the payload is missing them ──
        if (!extractedResults && fileUrls.length === 0) {
          const { data: existing } = await ctx.supabaseAdmin.from('mortgage_cases').select('*').eq('id', caseId).single();
          const proc = existing?.score_data?._processing;
          fileUrls = proc?.fileUrls || [];
          extractedResults = proc?.extractedResults || null;
          if ((!wizardData || Object.keys(wizardData).length === 0) && proc?.wizardData) {
            wizardData = proc.wizardData;
          }
          if (!dealContext && proc?.dealContext) dealContext = proc.dealContext;
        }

        // ── Auto-infer loan_purpose=refinance ──
        if (!dealContext) {
          const purpose = (wizardData.loanPurposeWizard || wizardData.caseType || '').toLowerCase();
          const isRefi = purpose.includes('refinance') || purpose.includes('מחזור') || purpose.includes('מיחזור') ||
            purpose.includes('איחוד') || (wizardData.loansToCloseAmount || 0) > 0;
          if (isRefi) dealContext = { loan_purpose: 'refinance' };
        }

        let failedCount = 0;
        let totalCount = 0;
        let extractedData = null;

        if (Array.isArray(extractedResults) && extractedResults.length > 0) {
          totalCount = extractedResults.length;
          failedCount = extractedResults.filter(r => !r || r.error || r._failed).length;
          console.log(`processUnderwriterCase: merging ${totalCount} pre-extracted JSON results, ${failedCount} failed`);
          extractedData = mergeExtractions(extractedResults);
          if (failedCount > 0) {
            console.error(`processUnderwriterCase: PARTIAL EXTRACTION — ${failedCount}/${totalCount} failed`);
          }

          // ── DB State Fix: if every chunk failed, nothing to process — close to failed immediately ──
          if (failedCount === totalCount && totalCount > 0) {
            await ctx.supabaseAdmin.from('mortgage_cases').update({
              case_status: 'under_review',
              score_data: { _processing: { status: 'failed', error: `כל ${totalCount} הקבצים נכשלו בחילוץ. אנא נסה להעלות מחדש.`, failed_at: new Date().toISOString() } }
            }).eq('id', caseId);
            return { error: 'all chunks failed extraction', caseId };
          }
        } else if (fileUrls.length > 0) {
          // DEFERRED: extractDocData (server-side fallback extraction) was not
          // ported — see MIGRATION NOTE above. Fail closed with a clear error
          // rather than silently returning no data.
          console.error('processUnderwriterCase: fileUrls-only path hit extractDocData deferral — not supported in this deployment');
        }

        if (!extractedData) {
          await ctx.supabaseAdmin.from('mortgage_cases').update({
            case_status: 'under_review',
            score_data: { _processing: { status: 'failed', error: 'אין נתונים מחולצים לעיבוד בתיק זה', failed_at: new Date().toISOString() } }
          }).eq('id', caseId);
          return { error: 'no extracted data for case', caseId };
        }

        extractedData = {
          ...extractedData,
          borrowers: extractedData.borrowers || [],
          payslips_borrower1: extractedData.payslips_borrower1 || [],
          payslips_borrower2: extractedData.payslips_borrower2 || [],
        };

        const { data: normalizeData } = await ctx.supabaseAdmin.functions.invoke('normalizeDocData', { body: { rawData: extractedData, dealContext } });
        let normalizedData = normalizeData || extractedData;

        // ── EMPLOYER SOURCE-OF-TRUTH LOCK ──
        // After normalization: locks the employer field to the dominant employer
        // on the payslips. Prevents the Citibank/RSU bug — a bank statement can
        // never overwrite the employer name from the payslip.
        try {
          const { data: lockData } = await ctx.supabaseAdmin.functions.invoke('lockEmployerFromPayslips', {
            body: {
              borrowers: normalizedData.borrowers || [],
              payslips_borrower1: normalizedData.payslips_borrower1 || [],
              payslips_borrower2: normalizedData.payslips_borrower2 || []
            }
          });
          if (lockData?.borrowers) {
            normalizedData = { ...normalizedData, borrowers: lockData.borrowers };
          }
        } catch (lockErr) {
          console.warn('lockEmployerFromPayslips failed (non-fatal):', lockErr?.message);
        }

        const dc = dealContext || {};
        const reqMortgageAmt = wizardData.requestedMortgageAmount || dc.requested_mortgage_amount || 0;
        const estPropValue = wizardData.estimatedPropertyValue || dc.estimated_property_value || 0;
        const targetRate = wizardData.targetInterestRate || dc.target_interest_rate || 0;
        const termYears = wizardData.loanTermYears || dc.loan_term_years || 0;

        let proposedMonthlyPayment = wizardData.proposedMonthlyPayment || dc.projected_monthly_payment || 0;
        if (proposedMonthlyPayment <= 0 && reqMortgageAmt > 0 && targetRate > 0 && termYears > 0) {
          const r = targetRate / 100 / 12;
          const n = termYears * 12;
          proposedMonthlyPayment = Math.round(reqMortgageAmt * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
        }

        const { data: scoreData, error: reportError } = await ctx.supabaseAdmin.functions.invoke('buildUnderwriterReport', {
          body: {
            normalizedData,
            caseType: wizardData.caseType || (dc.loan_purpose === 'refinance' ? 'refinance' : 'mortgage'),
            contractPrice: wizardData.contractPrice || 0,
            requestedMortgageAmount: reqMortgageAmt,
            equity: wizardData.equity || 0,
            estimatedPropertyValue: estPropValue,
            existingMortgageBalanceWizard: wizardData.existingMortgageBalanceWizard || normalizedData?.existing_mortgage?.remaining_balance || 0,
            loansToCloseAmount: wizardData.loansToCloseAmount || 0,
            requestedLoanAmountWizard: wizardData.requestedLoanAmountWizard || reqMortgageAmt,
            loanPurposeWizard: wizardData.loanPurposeWizard || dc.loan_purpose || '',
            proposedMonthlyPayment,
            targetInterestRate: targetRate,
            loanTermYears: termYears
          }
        });

        if (reportError || !scoreData || scoreData.error) {
          await ctx.supabaseAdmin.from('mortgage_cases').update({
            case_status: 'under_review',
            score_data: { _processing: { status: 'failed', error: scoreData?.error || reportError?.message || 'שגיאה בבניית דוח', failed_at: new Date().toISOString() } }
          }).eq('id', caseId);
          return { error: scoreData?.error || reportError?.message || 'report failed', caseId };
        }

        const borrower1 = normalizedData?.borrowers?.[0] || {};

        if (failedCount > 0) {
          scoreData._extraction_warning = {
            partial: true,
            failed_files_count: failedCount,
            total_files_count: totalCount,
            message: `אזהרה: ${failedCount} מתוך ${totalCount} קבצים נכשלו בחילוץ. מומלץ להריץ ניתוח מחדש.`
          };
        }

        await ctx.supabaseAdmin.from('mortgage_cases').update({
          case_status: failedCount > 0 ? 'under_review' : 'completed',
          score_data: scoreData,
          analysis_timestamp: new Date().toISOString(),
          primary_borrower: {
            full_name: borrower1.name || borrower1.full_name || 'ניתוח ידני',
            id_number: borrower1.id || borrower1.id_number || '',
            monthly_net_income: scoreData?.kpi?.income_b1 || borrower1.net_monthly_income || 0,
          },
        }).eq('id', caseId);

        return { success: true, caseId, status: 'completed' };
      })();

      // ── Race: work vs. timeout ──
      const result = await Promise.race([workPromise, timeoutPromise]);
      clearTimeout(timeoutId);
      return Response.json(result, { status: result?.timeout ? 408 : 200 });

    } catch (error) {
      clearTimeout(timeoutId);
      const isTimeout = error?.message === 'TIMEOUT_145';
      const errMsg = isTimeout
        ? 'TIMEOUT_145 — הניתוח חרג מ-145 שניות. נסה שנית.'
        : (error?.message || 'שגיאה לא ידועה');

      console.error(`processUnderwriterCase ${isTimeout ? 'TIMEOUT_145' : 'ERROR'}: ${errMsg}`);

      // ── Always update the DB — never leave a case stuck in 'processing' ──
      if (caseId) {
        try {
          await ctx.supabaseAdmin.from('mortgage_cases').update({
            case_status: 'under_review',
            score_data: { _processing: { status: 'failed', error: errMsg, timed_out: isTimeout, failed_at: new Date().toISOString() } }
          }).eq('id', caseId);
        } catch (_) { /* ignore secondary DB error */ }
      }

      return Response.json({ error: errMsg, caseId, timeout: isTimeout }, { status: 200 });
    }
  }),
};
