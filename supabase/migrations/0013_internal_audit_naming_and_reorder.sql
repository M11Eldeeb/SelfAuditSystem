-- Lets an audit be named and dated before it starts (shown on the report and
-- used when emailing the branch admin a heads-up ahead of the visit).
alter table self_audit_internal_audits add column if not exists name text;
alter table self_audit_internal_audits add column if not exists audit_date date;

-- "Clock ON/OFF recorded" should be checked before "QC sheet completed" in
-- the workshop walkthrough order.
update self_audit_audit_questions set sort_order = 12 where id = 'clockings';
update self_audit_audit_questions set sort_order = 13 where id = 'qcSheet';
