-- Claims & Financials -> Payments tracker.
--  * self_audit_payment_orders: SAIC's monthly payment orders (from the "Payment List Query List" export the officer
--    uploads): amount with VAT, creation date - and our own tracking: pending / remitted (pending by default), the
--    amount actually received, notes, and the Drive folder with the payment evidence
--    (Monthly Warranty Payments / <Payment order>-<Creation date>).
--  * self_audit_payment_files: the evidence files.
--  * payment_order_breakdown(): per payment order and settlement order, from the claims export - claims, settled
--    amount (Settle TOL. (VAT)), average days from first submit to settlement date.
--  * pending_settlement_by_month(): claims submitted but not settled yet (no settlement order, a first submit date, and a
--    status other than Rejected / Closed / Rejected from chief agent / Returned from chief agent), by first-submit month.
create table if not exists self_audit_payment_orders (
  payment_order text primary key,
  creation_date date,
  total_vat numeric(14, 2) not null default 0,
  total_novat numeric(14, 2),
  currency text not null default 'USD',
  saic_status text,
  remit_status text not null default 'pending' check (remit_status in ('pending', 'remitted')),
  remitted_at date,
  received_amount numeric(14, 2),
  notes text,
  drive_folder_id text,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  imported_at timestamptz not null default now()
);

create table if not exists self_audit_payment_files (
  id uuid primary key default gen_random_uuid(),
  payment_order text not null references self_audit_payment_orders (payment_order) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references self_audit_users (id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_payment_files_po_idx on self_audit_payment_files (payment_order);

alter table self_audit_payment_orders enable row level security;
alter table self_audit_payment_files enable row level security;
create policy "officers read payment orders" on self_audit_payment_orders for select using ((select current_user_role()::text) = 'officer');
create policy "officers read payment files" on self_audit_payment_files for select using ((select current_user_role()::text) = 'officer');

create or replace function public.payment_order_breakdown()
returns table (payment_order text, settlement_order text, claims bigint, settled numeric, avg_days numeric)
language sql stable security definer set search_path = public
as $$
  select raw_row->>'Payment Order', raw_row->>'Settlement Order', count(*),
         round(sum(nullif(raw_row->>'Settle TOL.(VAT)', '')::numeric), 2),
         round(avg((nullif(raw_row->>'Settlement Date', '')::date - nullif(raw_row->>'First Submit Date', '')::date))::numeric, 1)
  from self_audit_claims
  where coalesce(raw_row->>'Payment Order', '') <> ''
  group by 1, 2;
$$;

create or replace function public.pending_settlement_by_month()
returns table (month text, claims bigint, amount numeric)
language sql stable security definer set search_path = public
as $$
  select left(raw_row->>'First Submit Date', 7), count(*), round(sum(coalesce(claim_amount, 0)), 2)
  from self_audit_claims
  where coalesce(raw_row->>'Settlement Order', '') = ''
    and coalesce(raw_row->>'First Submit Date', '') <> ''
    and coalesce(raw_row->>'Status', '') not in ('Rejected', 'Closed', 'Rejected from chief agent', 'Returned from chief agent')
  group by 1;
$$;

revoke all on function public.payment_order_breakdown() from public, anon, authenticated;
revoke all on function public.pending_settlement_by_month() from public, anon, authenticated;
grant execute on function public.payment_order_breakdown() to service_role;
grant execute on function public.pending_settlement_by_month() to service_role;
