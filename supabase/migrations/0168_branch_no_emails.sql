-- A branch can be muted: no e-mails at all go out for it (Qassim). Its claims also stay out of the all-branches lists.
alter table public.self_audit_branches add column if not exists no_emails boolean not null default false;
update public.self_audit_branches set no_emails = true where code = 'QSM';
