-- Brings the standalone "Internal Audit" tool (warranty_audit_app.html) into this
-- app as an officer-only workflow that shares the same claims data as self-audit,
-- so a claim audited by either workflow is never resampled by the other.
--
-- Table names here use the "self_audit_" prefix, matching this app's tables
-- after they were renamed to share one Supabase project across multiple apps
-- (self_audit_*, hub_*, sub_dealer_*). Migrations 0001-0008 predate that
-- rename and still reference the old unprefixed names as historical record -
-- this is the first migration written directly against the new names.

-- ---------------------------------------------------------------------------
-- New claim fields, needed for risk-based ("flagged") internal-audit sampling.
-- Column-name aliases in parse-claims.ts are best guesses against the real
-- export's headers and may need one round of tuning, same as every other
-- field added to this parser.
-- ---------------------------------------------------------------------------

alter table self_audit_claims add column if not exists claim_amount numeric;
alter table self_audit_claims add column if not exists prior_approval text;
alter table self_audit_claims add column if not exists return_times numeric;
alter table self_audit_claims add column if not exists return_times_dealer numeric;
alter table self_audit_claims add column if not exists labor_code text;

-- ---------------------------------------------------------------------------
-- self_audit_audit_questions: a third scope ('parts', in addition to
-- 'claim'/'branch'), a department grouping (matches warranty_audit_app.html's
-- DEPARTMENTS - reception/workshop/parts/warrantyops/branchops - used for
-- internal audit's report tables and department-averaged scoring), and
-- canned remediation suggestions per checkpoint (ported verbatim from that
-- tool's SUGGESTION_LIB). None of this is read by the existing self-audit UI,
-- which filters .eq("scope","claim") / .eq("scope","branch") explicitly.
-- ---------------------------------------------------------------------------

alter table self_audit_audit_questions add column if not exists department text;
alter table self_audit_audit_questions add column if not exists remediation_suggestion text;

update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Cross-check the odometer photo against the job card entry at reception, and reject due-in if the two don''t match.'
  where id = 'mileage';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Make the customer signature a mandatory field before the job card can be released to the workshop.'
  where id = 'signature';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Timestamp due-in automatically from the reception system rather than hand-entry, to remove transcription drift.'
  where id = 'duein';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Attach the signed repair agreement to the digital job card at intake so it can''t be closed without it.'
  where id = 'agreement';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Require the reception advisor to transcribe the verbal complaint onto the RO before the vehicle moves to the bay.'
  where id = 'concernOnRO';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Coach reception staff to capture when, where, what and how for every complaint - especially noise complaints, which should name the noise type and source area.'
  where id = 'concernDesc';
update self_audit_audit_questions set department = 'reception', remediation_suggestion =
  'Make the service manager''s signature on the job card a hard gate before any add-on repair starts - spot-check that it''s present, not just that the repair was logged.'
  where id = 'addon';

update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Enforce the 3Cs (Complaint / Cause / Correction) as required fields in the technician write-up before a job can be marked complete.'
  where id = 'techwriteup';
update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Add a system prompt that blocks job closure until the repair end date is entered.'
  where id = 'repairEndDate';
update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Capture technician identity directly on the job card (name, badge or clock-on ID) - the labor operation code alone doesn''t identify who did the work.'
  where id = 'techName';
update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Have the parts counter withhold issue until the requisition carries a signature.'
  where id = 'partReq';
update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Make the QC sheet a gating step before the vehicle is released to delivery.'
  where id = 'qcSheet';
update self_audit_audit_questions set department = 'workshop', remediation_suggestion =
  'Audit clock ON/OFF logs weekly against job cards to catch gaps early rather than at the quarterly audit.'
  where id = 'clockings';

update self_audit_audit_questions set department = 'warrantyops', remediation_suggestion =
  'Add a document-completeness check to the closing checklist before a claim is submitted.'
  where id = 'docs';

update self_audit_audit_questions set department = 'branchops', remediation_suggestion =
  'Review the scrapping route for security exposure - parts should not transit through public or unsecured areas.'
  where id = 'scrapping';
update self_audit_audit_questions set department = 'branchops', remediation_suggestion =
  'Digitize job card archiving at point of closure, and spot-check a sample of archived cards for completeness and legibility, not just presence.'
  where id = 'archiving';
update self_audit_audit_questions set department = 'branchops', remediation_suggestion =
  'Set a warranty-room standard (labeling, shelving, access control) and audit it on the same cadence as other branch processes so storage quality doesn''t drift between audits.'
  where id = 'partsStorage';

insert into self_audit_audit_questions
  (id, sort_order, scope, department, text, help_text, type, options, required, ai_checkable, remediation_suggestion, compliant_options, partial_credit_options)
values
  ('availability', 1, 'parts', 'parts', 'Part availability', 'The defected part is physically stored and available in the warranty room.',
    'score_5', '["0","25","50","75","100"]', true, false,
    'Keep a warranty-room parts log so any sampled claim''s defected part can be physically located during an audit, not just marked as returned.',
    '[]', '[]'),

  ('serial', 2, 'parts', 'parts', 'Serial number recorded', 'Removed part serial number is logged, and its manufacture date lines up with the vehicle''s offline date.',
    'score_5', '["0","25","50","75","100"]', true, false,
    'Record the part''s serial-coded manufacture date at removal and flag any part whose manufacture date postdates the vehicle''s offline date - a sign of a reused or mismatched part.',
    '[]', '[]'),

  ('tag', 3, 'parts', 'parts', 'Part tag information complete', 'Tag includes VIN, date and job card number.',
    'score_5', '["0","25","50","75","100"]', true, false,
    'Standardize the part tag template with VIN, date and job card number pre-printed to reduce omissions.',
    '[]', '[]');

-- ---------------------------------------------------------------------------
-- Internal Audit tables. Officer-only (no branch_admin access at all) -
-- mirrors the self-audit assignment/answer/branch-ops shapes so the existing
-- scoring/photo-status helpers work unmodified where reused.
-- ---------------------------------------------------------------------------

create table self_audit_internal_audits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references self_audit_branches (id), -- null = "All branches"
  date_from date,
  date_to date,
  sample_size int not null,
  sample_mode text not null default 'random', -- 'flagged' | 'random'
  max_per_part int,
  auditor_id uuid references self_audit_users (id),
  manager_name text,
  status text not null default 'in_progress', -- 'in_progress' | 'finalized'
  closing_statement text,
  score_pct numeric,
  per_question_breakdown jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table self_audit_internal_audit_claims (
  id uuid primary key default gen_random_uuid(),
  internal_audit_id uuid not null references self_audit_internal_audits (id) on delete cascade,
  claim_id uuid not null references self_audit_claims (id),
  sort_order int not null default 0,
  unique (internal_audit_id, claim_id)
);

create table self_audit_internal_audit_answers (
  internal_audit_claim_id uuid not null references self_audit_internal_audit_claims (id) on delete cascade,
  question_id text not null references self_audit_audit_questions (id),
  answer_value text,
  updated_at timestamptz not null default now(),
  primary key (internal_audit_claim_id, question_id)
);

create table self_audit_internal_audit_notes (
  internal_audit_claim_id uuid primary key references self_audit_internal_audit_claims (id) on delete cascade,
  note_text text,
  updated_at timestamptz not null default now()
);

create table self_audit_internal_audit_branch_answers (
  internal_audit_id uuid not null references self_audit_internal_audits (id) on delete cascade,
  question_id text not null references self_audit_audit_questions (id),
  answer_value text,
  updated_at timestamptz not null default now(),
  primary key (internal_audit_id, question_id)
);

create table self_audit_internal_audit_department_remarks (
  internal_audit_id uuid not null references self_audit_internal_audits (id) on delete cascade,
  department_id text not null, -- reception|workshop|parts|warrantyops|branchops - not FK'd, matches self_audit_audit_questions.department
  remark_text text,
  primary key (internal_audit_id, department_id)
);

alter table self_audit_internal_audits enable row level security;
alter table self_audit_internal_audit_claims enable row level security;
alter table self_audit_internal_audit_answers enable row level security;
alter table self_audit_internal_audit_notes enable row level security;
alter table self_audit_internal_audit_branch_answers enable row level security;
alter table self_audit_internal_audit_department_remarks enable row level security;

create policy "officers manage internal_audits" on self_audit_internal_audits for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "officers manage internal_audit_claims" on self_audit_internal_audit_claims for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "officers manage internal_audit_answers" on self_audit_internal_audit_answers for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "officers manage internal_audit_notes" on self_audit_internal_audit_notes for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "officers manage internal_audit_branch_answers" on self_audit_internal_audit_branch_answers for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "officers manage internal_audit_department_remarks" on self_audit_internal_audit_department_remarks for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
