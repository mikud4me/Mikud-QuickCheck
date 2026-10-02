-- Ported from base44/entities/{MortgageCase,Document,Message,AuditLog}.jsonc
-- for מרכז חיתום מוסדי (UnderwriterDashboard). Self-contained case-data model,
-- NOT synced with the live Base44 app's MortgageCase store (shared by ~20
-- other functions/~35 files there this port deliberately doesn't touch).
--
-- Nested/free-form data (primary_borrower, score_data, etc.) is stored as
-- jsonb rather than normalized: nothing in the ported functions
-- (buildUnderwriterReport, processUnderwriterCase) queries inside these
-- relationally -- they're always read/written whole in JS.
--
-- ⚠️ NO AUTH, BY EXPLICIT DECISION (2026-08-19): unlike the first port of
-- this feature (Mikud-RefinanceQuickCheck, gated behind Supabase Auth +
-- appMetadata.role='admin'), this copy sits in the public app alongside
-- בדיקה מהירה/בדיקת מחזור מהירה with no login at all -- every table below is
-- anon-accessible, same trust model as refinance_leads. This means anyone
-- with the URL can view/edit case data (names, IDs, income, bank statements)
-- and approve/reject decisions. Confirmed explicitly with the user, who
-- accepted this trade-off; not an oversight.

create table if not exists mortgage_cases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  case_number text not null,

  -- Not in the original MortgageCase.jsonc schema (Base44's schema-less store
  -- let AsyncDocumentUpload.jsx write it as an ad-hoc field anyway) but it IS
  -- read back by UnderwriterDashboard.jsx (case_type drives the analysis
  -- mode when reloading an existing case) -- a real, load-bearing field.
  case_type text not null default 'mortgage',

  -- Real enum used by the ported functions (processUnderwriterCase,
  -- buildUnderwriterReport) includes 'processing'/'rejected' beyond the
  -- 5 values in the original MortgageCase.jsonc's stale enum.
  case_status text not null default 'new'
    check (case_status in ('new', 'processing', 'sabbatical_risk', 'approved', 'under_review', 'rejected', 'completed')),

  primary_borrower jsonb not null default '{}'::jsonb,
  secondary_borrower jsonb not null default '{}'::jsonb,
  property jsonb not null default '{}'::jsonb,
  existing_mortgage jsonb not null default '{}'::jsonb,
  loans jsonb not null default '[]'::jsonb,
  credit_cards jsonb not null default '[]'::jsonb,

  analysis_timestamp timestamptz,
  notes text,
  score_data jsonb not null default '{}'::jsonb,
  underwriter_decision jsonb
);

create trigger mortgage_cases_set_updated_at
  before update on mortgage_cases
  for each row
  execute function set_updated_at();

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  case_id uuid not null references mortgage_cases(id) on delete cascade,
  document_type text not null
    check (document_type in ('salary_slip', 'tax_assessment', 'cpa_letter', 'employment_letter',
      'sabbatical_letter', 'return_to_work_letter', 'bank_statement', 'mortgage_statement',
      'loan_statement', 'id_card', 'property_registry', 'other')),
  file_url text not null,
  month_year text,
  extracted_data jsonb not null default '{}'::jsonb,
  borrower_id text,
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'invalid', 'needs_review')),
  validation_notes text,
  upload_date timestamptz not null default now()
);

create trigger documents_set_updated_at
  before update on documents
  for each row
  execute function set_updated_at();

-- is_internal is the only field InternalNotes.jsx actually reads/writes.
-- sender_name/sender_email are filled with a fixed placeholder (no real user
-- identity exists without auth) -- see InternalNotes.jsx.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  case_id uuid not null references mortgage_cases(id) on delete cascade,
  sender_type text not null check (sender_type in ('client', 'admin')),
  sender_name text not null,
  sender_email text not null,
  content text not null,
  read boolean not null default false,
  timestamp timestamptz not null default now(),
  is_internal boolean not null default false
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  user_email text not null,
  action_type text not null check (action_type in ('view', 'edit', 'delete', 'export', 'login', 'data_access')),
  target_entity text,
  target_id text,
  description text,
  ip_address text,
  user_agent text,
  sensitive_data boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

-- RLS: no auth in this app at all -- every table is anon-accessible, same
-- trust model already accepted for refinance_leads/documents storage.
alter table mortgage_cases enable row level security;
alter table documents enable row level security;
alter table messages enable row level security;
alter table audit_log enable row level security;

create policy "anon has full access to mortgage_cases"
  on mortgage_cases for all
  to anon
  using (true) with check (true);

create policy "anon has full access to documents"
  on documents for all
  to anon
  using (true) with check (true);

create policy "anon has full access to messages"
  on messages for all
  to anon
  using (true) with check (true);

create policy "anon has full access to audit_log"
  on audit_log for all
  to anon
  using (true) with check (true);

alter publication supabase_realtime add table messages;
