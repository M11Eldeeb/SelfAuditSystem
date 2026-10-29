-- Open WIPs: the Autoline open-WIP report (Google Sheet tab FF3, or an uploaded file). Each import replaces the
-- snapshot - an invoiced WIP leaves the report and so leaves the table. The daily count per operator is written by
-- each import (older days are seeded from the sheet's "Daily History" tab). Notes are kept by branch + WIP number, so
-- they survive re-imports.

create table if not exists self_audit_open_wips (
  key text primary key,                 -- "<Co>|<WIPNO>"
  dealer_code text not null,            -- Co: A7, B7, ...
  branch_id uuid references self_audit_branches(id),
  dept text,                            -- D
  wip_no text not null,
  job text,
  in_out text,                          -- IN / OUT
  received date,
  due_out date,
  invoiceable numeric,
  wip_parts numeric,
  wip_labour numeric,
  account text,
  invoice_no text,
  status_code text,                     -- S
  wip_status text,
  parts_status text,
  vin text,
  taken_hr numeric,
  operator text,
  registration text,
  model text,
  note1 text, note2 text, note3 text, note4 text,
  order_ref text,
  approve text,
  insurer text,
  mileage numeric,
  sale_type text,                       -- "Description": Retail / Insurance / Warranty / ...
  taken numeric,
  brand text,
  repeat_repair text,
  first_seen date not null default ((now() at time zone 'Asia/Riyadh')::date),
  imported_at timestamptz not null default now()
);
create index if not exists self_audit_open_wips_branch_idx on self_audit_open_wips (branch_id);
alter table self_audit_open_wips enable row level security;

create table if not exists self_audit_open_wip_daily (
  day date not null,
  dealer_code text not null,
  operator text not null,
  branch_id uuid references self_audit_branches(id),
  count integer not null,
  source text not null default 'portal', -- portal / sheet history
  primary key (day, dealer_code, operator)
);
create index if not exists self_audit_open_wip_daily_branch_idx on self_audit_open_wip_daily (branch_id, day);
alter table self_audit_open_wip_daily enable row level security;

create table if not exists self_audit_open_wip_notes (
  key text primary key,
  note text not null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table self_audit_open_wip_notes enable row level security;

create table if not exists self_audit_open_wip_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null,                 -- sheet / upload
  file_name text,
  rows integer not null default 0,
  opened integer not null default 0,    -- WIPs not in the previous snapshot
  closed integer not null default 0,    -- WIPs gone since the previous snapshot (invoiced)
  imported_by_name text,
  imported_at timestamptz not null default now()
);
alter table self_audit_open_wip_imports enable row level security;

-- Twice a day (08:00 and 16:00 Saudi time), every day.
select cron.schedule('self-audit-open-wips', '0 5,13 * * *', $$select public.call_cron_route('/api/cron/open-wips')$$);
