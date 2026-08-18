-- Adds:
--   claims.work_order_no      - shown to branch admins alongside the claim number
--   claims.has_parts          - true unless the claim is labor-only; cycle
--                                generation only samples claims with parts
--   branches.active           - closed branches are skipped by cycle generation
-- Changes the claims uniqueness key from (branch_id, claim_number, upload_batch_id)
-- to (branch_id, claim_number) so re-uploading a cumulative monthly export
-- updates existing claims in place (upsert) instead of duplicating them.

alter table claims add column if not exists work_order_no text;
alter table claims add column if not exists has_parts boolean not null default true;

alter table branches add column if not exists active boolean not null default true;

alter table claims drop constraint if exists claims_branch_id_claim_number_upload_batch_id_key;
alter table claims add constraint claims_branch_id_claim_number_key unique (branch_id, claim_number);
