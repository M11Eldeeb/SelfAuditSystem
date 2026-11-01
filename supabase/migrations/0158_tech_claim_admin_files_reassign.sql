-- Technician claims: the warranty admin can add files after submission, and return a claim to another technician of
-- the branch - both are written in the claim's history.
alter table self_audit_tech_claim_events drop constraint if exists self_audit_tech_claim_events_kind_check;
alter table self_audit_tech_claim_events add constraint self_audit_tech_claim_events_kind_check
  check (kind = any (array['submitted', 'resubmitted', 'approved', 'returned', 'rejected', 'edited', 'files_added', 'reassigned']));
