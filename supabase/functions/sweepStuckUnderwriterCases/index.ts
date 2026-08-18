import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

/**
 * sweepStuckUnderwriterCases — safety net (fallback sweeper).
 *
 * Runs every 5 minutes (pg_cron, see migration). Finds מרכז חיתום מוסדי cases
 * stuck at case_status='processing' for more than STUCK_MINUTES minutes
 * (avoids trampling genuinely active work) and re-invokes the worker
 * (processUnderwriterCase) with the same up-to-date extraction engine.
 *
 * ── MIGRATION NOTE (Base44 → Supabase) ──
 * - base44.auth.me() + permissive "no user OR admin" check → auth: ["secret"]
 *   only. The original allowed both a truly anonymous scheduled caller AND an
 *   admin user through, rejecting only a logged-in non-admin. Since this repo's
 *   cron caller (pg_net → this function's URL, see migration) always carries
 *   the service-role key, "secret" mode alone covers it — and is strictly
 *   tighter than the original (no anonymous/browser access at all), which is
 *   correct: nothing should call this except the scheduler.
 * - asServiceRole.entities.MortgageCase.filter/functions.invoke →
 *   ctx.supabaseAdmin.from('mortgage_cases')/functions.invoke(...).
 * - updated_date/created_date (Base44 auto fields) → updated_at/created_at
 *   (this repo's actual column names, see migration 20260818090000).
 */
const STUCK_MINUTES = 8; // don't touch cases still actively processing — only genuinely stuck ones

export default {
  fetch: withSupabase({ auth: ["secret"] }, async (req, ctx) => {
    try {
      const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();

      // every case stuck in 'processing'
      const { data: processing } = await ctx.supabaseAdmin.from('mortgage_cases').select('*').eq('case_status', 'processing');
      const stuck = (processing || []).filter((c) => {
        const ts = c.updated_at || c.created_at;
        return ts && ts < cutoff && c.score_data?._processing?.fileUrls?.length > 0;
      });

      let requeued = 0;
      for (const c of stuck) {
        const proc = c.score_data._processing;
        // fire-and-forget — re-invokes the worker
        ctx.supabaseAdmin.functions.invoke('processUnderwriterCase', {
          body: { caseId: c.id, fileUrls: proc.fileUrls, wizardData: proc.wizardData || {} }
        }).catch(() => {});
        requeued++;
      }

      return Response.json({ checked: (processing || []).length, requeued }, { status: 200 });

    } catch (error) {
      console.error('sweepStuckUnderwriterCases error:', error);
      return Response.json({ error: error.message }, { status: 200 });
    }
  }),
};
