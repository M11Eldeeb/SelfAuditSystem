-- Quality control: the inspection sheet answers of each test (maintenance and/or GR sheet, by repair type).
alter table self_audit_qc_tests add column if not exists checklist jsonb;
