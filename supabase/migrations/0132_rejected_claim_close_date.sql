-- Rejected claims: the deadline is the estimated claim close date the officer enters by hand (SAIC closes the claim then -
-- no appeal after it), not a count of days from the verification date. The monthly summary and the weekend reminder
-- e-mails follow the "rejected_claims_mails" switch (on).
alter table self_audit_rejected_claim_reviews add column if not exists close_date date;
insert into self_audit_mail_settings (key, enabled, updated_at) values ('rejected_claims_mails', true, now())
on conflict (key) do update set enabled = true, updated_at = now();
