-- Warranty Invoicing (officer dashboard tab): the data analyst's daily "Jiad Aftersales Major Service Indicators Daily
-- Report" e-mail is read from a connected Gmail mailbox (read-only), its KH9-Labor and MG5-Parts sheets are summed per
-- day / branch / account / owing operator / sales type and kept here. Each import replaces the months it contains
-- (the report is month-to-date).

-- The mailbox the report is read from (OAuth refresh token, gmail.readonly). Service role only.
create table if not exists self_audit_invoicing_connection (
  id integer primary key default 1 check (id = 1),
  refresh_token text not null,
  account_email text not null,
  connected_by uuid references self_audit_users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table self_audit_invoicing_connection enable row level security;

create table if not exists self_audit_invoicing_imports (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null,
  subject text,
  received_at timestamptz,
  file_name text,
  labor_lines integer not null default 0,
  part_lines integer not null default 0,
  months date[] not null default '{}',
  imported_by uuid references self_audit_users (id) on delete set null,
  imported_at timestamptz not null default now()
);
create index if not exists self_audit_invoicing_imports_at_idx on self_audit_invoicing_imports (imported_at desc);
alter table self_audit_invoicing_imports enable row level security;
create policy "officers read invoicing imports" on self_audit_invoicing_imports for select using ((select current_user_role()::text) = 'officer');

create table if not exists self_audit_invoicing_lines (
  id bigint generated always as identity primary key,
  month date not null,
  invoice_date date,
  source text not null check (source in ('labor', 'parts')),
  branch text not null default '',
  account_code text not null default '',
  account_name text not null default '',
  owing_operator text not null default '',
  sales_type text not null default '',
  amount numeric(14, 2) not null default 0,
  lines integer not null default 0
);
create index if not exists self_audit_invoicing_lines_month_idx on self_audit_invoicing_lines (month);
alter table self_audit_invoicing_lines enable row level security;
create policy "officers read invoicing lines" on self_audit_invoicing_lines for select using ((select current_user_role()::text) = 'officer');

-- The report's own branch name (its branch codes - A7, B7... - differ from the portal's).
alter table self_audit_invoicing_lines add column if not exists branch_name text not null default '';
