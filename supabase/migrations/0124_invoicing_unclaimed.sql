-- Warranty Invoicing, part 3:
--  * every report line keeps its claim number and a stable key (so a mark survives the daily re-import);
--  * warranty lines invoiced without a claim number are marked by the officer as resolved or credit note (kept here
--    with a copy of the line, so the record stays after the line itself is purged);
--  * month totals for the trend chart, summed in the database (history is kept month by month: the analyst's file only
--    holds the current month).
alter table self_audit_invoicing_detail add column if not exists claim_no text not null default '';
alter table self_audit_invoicing_detail add column if not exists line_key text not null default '';
create index if not exists self_audit_invoicing_detail_unclaimed_idx on self_audit_invoicing_detail (month) where sales_type = 'Warranty' and claim_no = '';

create table if not exists self_audit_invoicing_unclaimed_marks (
  line_key text primary key,
  status text not null check (status in ('resolved', 'credit_note')),
  note text,
  month date not null,
  invoice_date date,
  source text not null,
  branch text not null default '',
  wip text not null default '',
  invoice_no text not null default '',
  item text not null default '',
  description text not null default '',
  amount numeric(14, 2) not null default 0,
  marked_by uuid references self_audit_users (id) on delete set null,
  marked_by_name text,
  marked_at timestamptz not null default now()
);
alter table self_audit_invoicing_unclaimed_marks enable row level security;
create policy "officers read invoicing marks" on self_audit_invoicing_unclaimed_marks for select using ((select current_user_role()::text) = 'officer');

create or replace function public.invoicing_monthly(p_type text, p_account text, p_branch text, p_operator text)
returns table (month date, source text, department text, amount numeric, lines bigint)
language sql stable security definer set search_path = public
as $$
  select month, source, department, sum(amount), sum(lines)::bigint
  from self_audit_invoicing_lines
  where (select current_user_role()::text) = 'officer'
    and (coalesce(p_type, '') = '' or sales_type = p_type)
    and (coalesce(p_account, '') = '' or account_code = p_account)
    and (coalesce(p_branch, '') = '' or branch = p_branch)
    and (coalesce(p_operator, '') = '' or owing_operator = p_operator)
  group by month, source, department
  order by month;
$$;
