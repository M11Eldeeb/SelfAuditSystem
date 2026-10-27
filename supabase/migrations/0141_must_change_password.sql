-- Accounts created with a password someone else chose (a shared one for an imported team) must pick their own at the
-- first sign-in: until then every page sends them to Change password.
alter table self_audit_users add column if not exists must_change_password boolean not null default false;
