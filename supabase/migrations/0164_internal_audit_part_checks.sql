-- Internal audit pre-visit parts check: per audit claim, how the part is verified (serial number or offline /
-- production date) and what the officer found.
alter table self_audit_internal_audit_claims
  add column if not exists check_method text check (check_method in ('serial', 'offline')),
  add column if not exists checked_serial text,
  add column if not exists checked_offline_date date,
  add column if not exists check_note text,
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by_name text;
