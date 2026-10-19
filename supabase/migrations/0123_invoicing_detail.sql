-- Warranty Invoicing: the department of each line (Labor / Consumables / Sublet; Workshop Parts / Lubes / Parts Counter /
-- Wholesale / Affiliates), and every report line kept as is so a click on a visual can show the lines behind it.
alter table self_audit_invoicing_lines add column if not exists department text not null default '';

create table if not exists self_audit_invoicing_detail (
  id bigint generated always as identity primary key,
  month date not null,
  invoice_date date,
  source text not null check (source in ('labor', 'parts')),
  branch text not null default '',
  account_code text not null default '',
  account_name text not null default '',
  owing_operator text not null default '',
  sales_type text not null default '',
  department text not null default '',
  wip text not null default '',
  invoice_no text not null default '',
  vin text not null default '',
  item text not null default '',
  description text not null default '',
  customer text not null default '',
  qty numeric(12, 2),
  amount numeric(14, 2) not null default 0
);
create index if not exists self_audit_invoicing_detail_month_idx on self_audit_invoicing_detail (month, invoice_date);
alter table self_audit_invoicing_detail enable row level security;
create policy "officers read invoicing detail" on self_audit_invoicing_detail for select using ((select current_user_role()::text) = 'officer');

-- Invoiced work orders (distinct branch + WIP) and line count for the dashboard's filters. Empty filter = all.
create or replace function public.invoicing_counts(p_month date, p_type text, p_account text, p_branch text, p_operator text)
returns table (work_orders bigint, lines bigint)
language sql stable security definer set search_path = public
as $$
  select count(distinct branch || '-' || wip) filter (where wip <> ''), count(*)
  from self_audit_invoicing_detail
  where (select current_user_role()::text) = 'officer'
    and month = p_month
    and (coalesce(p_type, '') = '' or sales_type = p_type)
    and (coalesce(p_account, '') = '' or account_code = p_account)
    and (coalesce(p_branch, '') = '' or branch = p_branch)
    and (coalesce(p_operator, '') = '' or owing_operator = p_operator);
$$;
