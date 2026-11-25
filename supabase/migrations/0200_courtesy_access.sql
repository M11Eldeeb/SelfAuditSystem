-- Courtesy cars for someone who is not a service advisor (e.g. a workshop supervisor): he may hand courtesy cars over
-- and take them back in his own branch, but he is not offered to the customer as a service advisor on the form.
alter table self_audit_users add column if not exists courtesy_access boolean not null default false;
