-- Replaces the questionnaire with the "documents" checkpoints from the
-- warranty_audit_app.html tool (drops the old parts-related questions),
-- switches scoring to a 0/25/50/75/100 scale, and adds a one-time "Branch
-- Operation" questionnaire answered once per branch per cycle after all 10
-- claims are done.
--
-- The in-progress July 2026 cycle (old 18-question answers) is deleted first
-- per instruction, since it's pre-production test data and the old question
-- set is being fully replaced. This cascades to its assignments, answers,
-- photos, notes and ai_reviews - the underlying claims are untouched.

delete from audit_cycles where cycle_month = '2026-07-01';

-- Now safe: nothing references the old questions any more.
delete from audit_questions;

alter table audit_questions add column if not exists scope text not null default 'claim';

insert into audit_questions
  (id, sort_order, scope, text, help_text, type, options, conditional_field, required, ai_checkable, ai_check_note, compliant_options, partial_credit_options)
values
  ('mileage', 1, 'claim', 'Mileage recorded accurately', 'Odometer reading on the job card matches the vehicle.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Cross-check the odometer reading visible on the job card photo against the mileage field in the uploaded claims data.',
    '[]', '[]'),

  ('signature', 2, 'claim', 'Customer signature present', 'Customer has signed the job card / concern acknowledgement.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the job card photos for a customer signature.', '[]', '[]'),

  ('duein', 3, 'claim', 'Due-in date accurate', 'Reception due-in date matches actual vehicle arrival.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Cross-check the reception/due-in date on the job card against the claim''s creation date in claims data.',
    '[]', '[]'),

  ('agreement', 4, 'claim', 'Repair agreement on file', 'Signed repair agreement is attached to the job card.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the repair agreement photo for a customer signature.', '[]', '[]'),

  ('concernOnRO', 5, 'claim', 'Customer concern captured on RO', 'The complaint is written on the repair order, not only noted verbally.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the job card photos for a written customer concern.', '[]', '[]'),

  ('concernDesc', 6, 'claim', 'Concern description quality', 'Describes when / where / what / how - not a one-word entry.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Judge the quality/detail of the written concern on the job card photo.', '[]', '[]'),

  ('addon', 7, 'claim', 'Add-on repairs approved', 'Any additional repairs found during inspection are approved via the service manager''s signature on the physical job card.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the job card photos for a service manager signature/approval on any add-on repairs.', '[]', '[]'),

  ('techwriteup', 8, 'claim', 'Technical write-up (3Cs)', 'Complaint, Cause and Correction are all documented.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Read the job card photos and judge whether Complaint, Cause, and Correction are all clearly written.', '[]', '[]'),

  ('repairEndDate', 9, 'claim', 'Repair end date recorded', 'End-of-repair date is filled on the job card.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Cross-check the end-of-repair date on the job card photo against repair_end_date in claims data.', '[]', '[]'),

  ('techName', 10, 'claim', 'Technician name / signature', 'Technician who performed the repair is identified on the job card.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the back of the job card photo for the technician''s name and signature.', '[]', '[]'),

  ('partReq', 11, 'claim', 'Part requisition signed', 'Parts requisition form carries a signature.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Check the parts requisition photo for a signature.', '[]', '[]'),

  ('qcSheet', 12, 'claim', 'QC sheet completed', 'Quality control checklist completed before closing the job.',
    'score_5', '["0","25","50","75","100"]', null, true, false, null, '[]', '[]'),

  ('clockings', 13, 'claim', 'Clock ON/OFF recorded', 'Technician time tracking is logged for the job.',
    'score_5', '["0","25","50","75","100"]', null, true, false, null, '[]', '[]'),

  ('docs', 14, 'claim', 'Supporting documents complete', 'All required documents are present and legible.',
    'score_5', '["0","25","50","75","100"]', null, true, true,
    'Judge whether all uploaded photos (job card front/back, repair agreement, parts requisition) are present and legible.',
    '[]', '[]'),

  ('scrapping', 1, 'branch', 'Scrapping process followed', 'Scrapped parts are routed and disposed of per policy - a branch-wide process check, not tied to one claim.',
    'score_5', '["0","25","50","75","100"]', null, true, false, null, '[]', '[]'),

  ('archiving', 2, 'branch', 'Job cards and archiving quality', 'Closed job cards are complete, legible and filed or scanned per retention policy - a branch-wide process check, not tied to one claim.',
    'score_5', '["0","25","50","75","100"]', null, true, false, null, '[]', '[]'),

  ('partsStorage', 3, 'branch', 'Warranty parts storage quality', 'The warranty room is organized, parts are tagged and locatable, and storage conditions meet policy - a branch-wide process check, not tied to one claim.',
    'score_5', '["0","25","50","75","100"]', null, true, false, null, '[]', '[]');

-- ---------------------------------------------------------------------------
-- Branch Operation questionnaire: answered once per (cycle, branch) after
-- the branch admin finishes all 10 per-claim audits.
-- ---------------------------------------------------------------------------

create type branch_ops_status as enum ('not_started', 'submitted', 'reviewed');

create table branch_operation_progress (
  cycle_id uuid not null references audit_cycles (id) on delete cascade,
  branch_id uuid not null references branches (id),
  status branch_ops_status not null default 'not_started',
  submitted_at timestamptz,
  submitted_by uuid references users (id),
  reviewed_at timestamptz,
  reviewed_by uuid references users (id),
  primary key (cycle_id, branch_id)
);

create table branch_operation_answers (
  cycle_id uuid not null references audit_cycles (id) on delete cascade,
  branch_id uuid not null references branches (id),
  question_id text not null references audit_questions (id),
  answer_value text,
  officer_value text,
  updated_at timestamptz not null default now(),
  primary key (cycle_id, branch_id, question_id)
);

alter table branch_operation_progress enable row level security;
alter table branch_operation_answers enable row level security;

create policy "officers manage branch_operation_progress" on branch_operation_progress for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own branch_operation_progress" on branch_operation_progress for all
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());

create policy "officers manage branch_operation_answers" on branch_operation_answers for all
  using (current_user_role() = 'officer') with check (current_user_role() = 'officer');
create policy "branch admins manage own branch_operation_answers" on branch_operation_answers for all
  using (branch_id = current_user_branch_id())
  with check (branch_id = current_user_branch_id());
