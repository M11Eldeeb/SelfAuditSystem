-- Technician claims: the warranty admin can label a claim "Prior approval" (a label only - nothing else changes).
alter table self_audit_tech_claims add column if not exists prior_approval boolean not null default false;
