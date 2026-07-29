-- Ported from base44/entities/RefinanceLead.jsonc
create table if not exists refinance_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  full_name text not null,
  email text not null,
  phone text not null,
  id_number text not null,

  status text not null default 'lead'
    check (status in ('lead', 'analyzed', 'error')),

  file_url text,
  has_extra_debts boolean,
  external_debts jsonb not null default '[]'::jsonb,
  analysis_result jsonb,
  analyzed_at timestamptz,

  tier text not null default 'free'
    check (tier in ('free', 'paid', 'premium')),
  tier_unlocked_at timestamptz
);

-- keep updated_at current on every row change
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger refinance_leads_set_updated_at
  before update on refinance_leads
  for each row
  execute function set_updated_at();

-- RLS: mirrors the app's existing security model, where the lead's UUID
-- itself (embedded in the resume-by-URL link) is the access control, not a
-- login. Anyone can create a lead (public quick-check form); read/update
-- requires already knowing the row's id (== knowing the resume URL).
alter table refinance_leads enable row level security;

create policy "anyone can create a lead"
  on refinance_leads for insert
  to anon
  with check (true);

create policy "anyone with the id can read their lead"
  on refinance_leads for select
  to anon
  using (true);

create policy "anyone with the id can update their lead"
  on refinance_leads for update
  to anon
  using (true)
  with check (true);
