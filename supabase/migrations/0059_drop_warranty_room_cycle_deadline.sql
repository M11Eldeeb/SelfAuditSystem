-- No deadline needed for the warranty room cycle - a branch that never
-- submits destroy evidence just never gets its flagged parts approved onto
-- the Scrapped List, which is enforcement enough on its own.
alter table self_audit_warranty_room_cycles drop column deadline_at;
