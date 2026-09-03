-- Matches the reference tool: both auditor and service manager names are
-- typed in at finalize/sign-off, not derived from the logged-in account -
-- multiple officers share this app, and the person conducting the audit
-- isn't always the one typing up the report.
alter table self_audit_internal_audits add column if not exists auditor_name text;
