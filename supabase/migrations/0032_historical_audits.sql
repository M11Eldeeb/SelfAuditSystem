-- Historical (pre-website) audit results: self-audit or internal-audit
-- scores from before this system existed, entered one branch+month at a
-- time since not every branch has a historical result for every period,
-- each backed by a PDF of the original report for reference.
create table public.self_audit_historical_audits (
  id uuid primary key default gen_random_uuid(),
  audit_type text not null check (audit_type in ('self_audit', 'internal_audit')),
  branch_id uuid not null references public.self_audit_branches (id) on delete cascade,
  period_month date not null,
  score_pct numeric not null check (score_pct >= 0 and score_pct <= 100),
  pdf_path text not null,
  notes text,
  uploaded_by uuid references public.self_audit_users (id),
  created_at timestamptz not null default now()
);

create index historical_audits_branch_idx on public.self_audit_historical_audits (branch_id);

alter table public.self_audit_historical_audits enable row level security;

create policy "officers manage historical_audits"
  on public.self_audit_historical_audits
  for all
  using (current_user_role() = 'officer'::user_role)
  with check (current_user_role() = 'officer'::user_role);

create policy "branch admins read own historical_audits"
  on public.self_audit_historical_audits
  for select
  using (branch_id = current_user_branch_id());

-- Standings needs every branch's historical internal-audit scores blended
-- into its all-time average, same reason as get_finalized_internal_audit_scores:
-- a branch admin's own RLS above only exposes their own branch's rows.
create or replace function public.get_historical_internal_audit_scores()
returns table (branch_id uuid, score_pct numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select branch_id, score_pct
  from self_audit_historical_audits
  where audit_type = 'internal_audit';
$$;
