-- Reconciliation tab (officer only): review settled claims per SAIC
-- settlement order, mark each loss as deducted by SAIC or internally, and
-- track it to reinvoiced / overdue with notes.

-- Settlement order lives only inside raw_row; without this index every
-- lookup scans (and decompresses) all claims and hits the 8s timeout.
create index if not exists self_audit_claims_settlement_order_idx
  on self_audit_claims ((raw_row->>'Settlement Order'))
  where raw_row->>'Settlement Order' is not null;

create table if not exists self_audit_reconciliation (
  claim_id uuid primary key references self_audit_claims (id) on delete cascade,
  deduction_type text check (deduction_type in ('saic', 'internal')),
  outcome text check (outcome in ('reinvoiced', 'overdue')),
  notes text,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table self_audit_reconciliation enable row level security;

create policy "officers manage reconciliation" on self_audit_reconciliation for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');

-- Distinct settlement orders, newest first. A loose index scan (one index
-- probe per distinct value) instead of grouping all ~60k claims.
create or replace function public.get_settlement_orders()
returns table (settlement_order text)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive orders(o) as (
    (select raw_row->>'Settlement Order' from self_audit_claims
      where raw_row->>'Settlement Order' is not null
      order by raw_row->>'Settlement Order' desc limit 1)
    union all
    select (select raw_row->>'Settlement Order' from self_audit_claims
              where raw_row->>'Settlement Order' is not null and raw_row->>'Settlement Order' < orders.o
              order by raw_row->>'Settlement Order' desc limit 1)
    from orders where orders.o is not null
  )
  select o from orders where o is not null;
$$;

grant execute on function public.get_settlement_orders() to authenticated;
