-- ── FIX: UnderwriterDashboard (מרכז חיתום מוסדי) was RLS-locked out ──
--
-- This app has NO login: every request reaches PostgREST as the `anon` role
-- using the publishable key (see src/api/supabaseClient.js). But on the live
-- project (megadcnmlgutwjgveced) the four underwriter tables were provisioned
-- — during the earlier auth-gated port of this feature — with policies that
-- grant ONLY the `authenticated` role:
--
--   "authenticated users have full access to mortgage_cases"  TO authenticated
--   "authenticated users have full access to documents"       TO authenticated
--   "authenticated users have full access to messages"        TO authenticated
--   "authenticated users have full access to audit_log"       TO authenticated
--
-- The repo's 20260818090000_create_underwriter_case_tables.sql DOES declare
-- the matching `anon` policies, but that migration is already recorded as
-- applied on this project, so re-running it (db push) is a no-op and the
-- remote never actually received them.
--
-- Net effect on the live site: anon inserts fail with 42501 ("new row
-- violates row-level security policy"), and anon selects silently return zero
-- rows — so creating a case, loading a case, InternalNotes and AuditLog all
-- break. The RLS-enabled tables are unreadable/unwritable to the only role the
-- app ever uses.
--
-- This migration reconciles the remote with the no-auth design the repo
-- already assumes. Idempotent, so it also applies cleanly to a from-scratch
-- project where 20260818090000 already created the anon policies.

drop policy if exists "anon has full access to mortgage_cases" on public.mortgage_cases;
create policy "anon has full access to mortgage_cases"
  on public.mortgage_cases for all
  to anon
  using (true) with check (true);

drop policy if exists "anon has full access to documents" on public.documents;
create policy "anon has full access to documents"
  on public.documents for all
  to anon
  using (true) with check (true);

drop policy if exists "anon has full access to messages" on public.messages;
create policy "anon has full access to messages"
  on public.messages for all
  to anon
  using (true) with check (true);

drop policy if exists "anon has full access to audit_log" on public.audit_log;
create policy "anon has full access to audit_log"
  on public.audit_log for all
  to anon
  using (true) with check (true);

-- The authenticated-only policies are dead weight in an app that never logs
-- anyone in, and they are actively misleading (they make the tables look
-- protected when the real access model is "anyone with the URL"). Drop them so
-- the table policies match the explicit no-auth decision documented in the
-- 20260818090000 migration header.
drop policy if exists "authenticated users have full access to mortgage_cases" on public.mortgage_cases;
drop policy if exists "authenticated users have full access to documents" on public.documents;
drop policy if exists "authenticated users have full access to messages" on public.messages;
drop policy if exists "authenticated users have full access to audit_log" on public.audit_log;
