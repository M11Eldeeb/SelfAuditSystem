-- Technician claims: the warranty admin marks "Defective part received" (who and when). Optional for every branch;
-- the claim of an E7 (Riyadh North) technician cannot be approved before it is marked. Written in the claim's history.
alter table self_audit_tech_claims
  add column if not exists defective_part_received boolean not null default false,
  add column if not exists defective_part_received_at timestamptz,
  add column if not exists defective_part_received_by_name text;

alter table self_audit_tech_claim_events drop constraint if exists self_audit_tech_claim_events_kind_check;
alter table self_audit_tech_claim_events add constraint self_audit_tech_claim_events_kind_check
  check (kind = any (array['submitted', 'resubmitted', 'approved', 'returned', 'rejected', 'edited', 'files_added', 'reassigned', 'part_received', 'part_not_received']));
