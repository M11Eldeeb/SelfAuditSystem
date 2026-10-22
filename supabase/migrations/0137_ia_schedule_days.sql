-- Internal audits last more than one day (usually 2 working days): planned_date is the first day, days the number of
-- working days (Fridays, Saturdays and holidays are skipped).
alter table self_audit_ia_schedule add column if not exists days integer not null default 2 check (days between 1 and 10);
