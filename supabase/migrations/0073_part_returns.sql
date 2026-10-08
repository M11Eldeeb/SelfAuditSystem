-- Part return requests: the manufacturer asks for parts back; the officer
-- picks claims + parts and sends one request per branch; the branch ships
-- them (waybill) or marks parts missing (justification); the officer tracks
-- deductions for missing parts and closes the request once it's forwarded to
-- the manufacturer (invoice, shipping company, waybill).

create table if not exists self_audit_part_returns (
  id uuid primary key default gen_random_uuid(),
  request_no bigint generated always as identity,
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  -- open: waiting on the branch; dispatched: branch closed it, parts on the
  -- way to the warranty team; closed: officer forwarded to the manufacturer.
  status text not null default 'open' check (status in ('open', 'dispatched', 'closed')),
  officer_note text,
  created_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now(),
  branch_waybill text,
  branch_closed_by uuid references self_audit_users (id) on delete set null,
  branch_closed_at timestamptz,
  invoice_no text,
  shipping_company text,
  oem_waybill text,
  closed_by uuid references self_audit_users (id) on delete set null,
  closed_at timestamptz
);

create index if not exists self_audit_part_returns_branch_idx on self_audit_part_returns (branch_id, status);

create table if not exists self_audit_part_return_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references self_audit_part_returns (id) on delete cascade,
  claim_id uuid references self_audit_claims (id) on delete set null,
  -- Snapshot of the claim/part at request time, so the request stays
  -- readable even if the claims export is re-uploaded.
  claim_number text not null,
  work_order_no text,
  vin text,
  claim_amount numeric,
  part_no text,
  part_name text,
  quantity numeric,
  status text not null default 'requested' check (status in ('requested', 'dispatched', 'missing')),
  missing_reason text,
  -- Missing parts: the claim amount may be deducted (tracker).
  deduction_status text not null default 'none' check (deduction_status in ('none', 'pending', 'deducted')),
  deducted_by uuid references self_audit_users (id) on delete set null,
  deducted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists self_audit_part_return_items_request_idx on self_audit_part_return_items (request_id);
create index if not exists self_audit_part_return_items_deduction_idx on self_audit_part_return_items (deduction_status) where deduction_status <> 'none';

alter table self_audit_part_returns enable row level security;
alter table self_audit_part_return_items enable row level security;

-- Reads go through RLS; all writes happen in server actions that check the
-- caller's role and branch first (and only touch the allowed columns).
create policy "officers manage part_returns" on self_audit_part_returns for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');
create policy "branch admins read own part_returns" on self_audit_part_returns for select
  using (branch_id = (select current_user_branch_id()));

create policy "officers manage part_return_items" on self_audit_part_return_items for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');
create policy "branch admins read own part_return_items" on self_audit_part_return_items for select
  using (exists (
    select 1 from self_audit_part_returns r
    where r.id = request_id and r.branch_id = (select current_user_branch_id())
  ));
