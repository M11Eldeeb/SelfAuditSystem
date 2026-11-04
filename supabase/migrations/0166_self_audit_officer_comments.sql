-- Self audit review: the officer's comment on each question and on the claim as a whole (shown to the branch once
-- reviewed).
alter table self_audit_ai_reviews add column if not exists officer_comment text;
alter table self_audit_audit_assignments add column if not exists officer_comment text;
