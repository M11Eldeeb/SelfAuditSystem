-- A free-text note for the Branch Operation phase, matching the per-claim
-- notes already available for Documents/Parts.
alter table self_audit_internal_audits add column if not exists branch_ops_note text;

-- The auto-generated recommendations (checkpoints scoring below 80%) are
-- reviewed, editable, and removable by the officer at finalize time, then
-- frozen here - the report reads this instead of recomputing fresh, so an
-- edit or removal made before finalizing sticks.
alter table self_audit_internal_audits add column if not exists recommendations jsonb;
