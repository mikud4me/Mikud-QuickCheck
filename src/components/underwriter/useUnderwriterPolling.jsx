import { useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';

/**
 * useUnderwriterPolling — tracks a case being processed until it finishes.
 * Checks case_status every 4 seconds. Once it becomes 'completed' →
 * onComplete(caseData). If it fails (under_review with
 * _processing.status='failed') → onFailed(error).
 *
 * ── MIGRATION NOTE (Base44 → Supabase) ──
 * base44.entities.MortgageCase.get(caseId) → supabase.from('mortgage_cases').select().eq('id', caseId).single().
 */
const POLLING_TIMEOUT_MS = 4.5 * 60 * 1000; // 4.5 minutes — enough for heavy cases

export function useUnderwriterPolling(caseId, { enabled, onComplete, onFailed }) {
  const timerRef = useRef(null);
  const doneRef = useRef(false);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!caseId || !enabled) return;
    doneRef.current = false;
    startTimeRef.current = Date.now();

    const poll = async () => {
      // ── Timeout Guard: if 3 minutes have passed and it's still processing — stop and show an error ──
      if (Date.now() - startTimeRef.current > POLLING_TIMEOUT_MS) {
        if (!doneRef.current) {
          doneRef.current = true;
          clearInterval(timerRef.current);
          onFailed?.('השרת עמוס, אנא נסה שוב. (timeout לאחר 3 דקות)');
        }
        return;
      }

      try {
        const { data: c } = await supabase.from('mortgage_cases').select('*').eq('id', caseId).single();
        if (!c || doneRef.current) return;

        const procStatus = c.score_data?._processing?.status;

        const hasReport = c.score_data?.kpi && (c.case_status === 'completed' || c.case_status === 'under_review');
        if (hasReport) {
          doneRef.current = true;
          clearInterval(timerRef.current);
          onComplete?.(c);
        } else if (procStatus === 'failed') {
          doneRef.current = true;
          clearInterval(timerRef.current);
          onFailed?.(c.score_data?._processing?.error || 'העיבוד נכשל');
        }
      } catch (_) { /* keep polling */ }
    };

    poll();
    timerRef.current = setInterval(poll, 4000);
    return () => clearInterval(timerRef.current);
  }, [caseId, enabled]);
}
