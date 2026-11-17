-- Major Service Indicators: the daily "Jiad Aftersales MSI Report" e-mail (an Excel file the data analyst sends every
-- day except Fridays and Saturdays - unless one of them is the last day of the month - dated the day before) is read from
-- the connected mailbox (the one the Warranty Invoicing report is read from) and kept here, one row per report date.
--  * meta / sales / advisors / wholesale: kept for every day (history, a few hundred KB each at most).
--  * extra (monthly closing, daily sales, KPIs, advisor targets): only on the newest report (the older rows get null) -
--    it is large and the older days' copies add nothing the newest one does not show.
-- Only the server (service role) reads and writes it: the page checks who may look.
create table if not exists self_audit_msi_reports (
  report_date date primary key,
  gmail_message_id text not null,
  subject text,
  file_name text,
  received_at timestamptz,
  imported_at timestamptz not null default now(),
  meta jsonb not null,
  sales jsonb not null,
  advisors jsonb not null,
  wholesale jsonb not null,
  extra jsonb
);
create index if not exists self_audit_msi_reports_imported_idx on self_audit_msi_reports (imported_at desc);
alter table self_audit_msi_reports enable row level security;

-- Looks for the new e-mail every 30 minutes from 06:00 to 12:30 Saudi time, every day (a month-end Friday or Saturday
-- gets one too); nothing is downloaded until a new e-mail is there.
select cron.schedule('self-audit-msi-report', '*/30 3-9 * * *', $$select public.call_cron_route('/api/cron/msi')$$);
