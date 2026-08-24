-- 1. 30-day self-audit submission deadline: audit_cycles gets a deadline_at
--    set at generation time; any claim assignment still not_started/
--    in_progress once the deadline passes is auto-marked 'expired' (scored
--    0%, excluded from the officer's review queue) - see
--    src/lib/expire-assignments.ts.
-- 2. Two new claim-scope photo requirements: QC report (required) and
--    supporting documents (optional).

alter type assignment_status add value if not exists 'expired';

alter table audit_cycles add column if not exists deadline_at timestamptz;

insert into audit_photo_types (id, sort_order, scope, label, help_text, required)
values
  ('photo_qc_report', 5, 'claim', 'QC Report Photo', 'Photo of the completed quality control report.', true),
  ('photo_supporting_documents', 6, 'claim', 'Supporting Documents',
    'e.g. AC table, sublet invoice, battery test, dismantling form, wheel alignment, etc. Only attach if this claim needed supporting evidence.',
    false);
