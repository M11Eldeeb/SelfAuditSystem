-- Support for the portal's automatic e-mails.
--
--  self_audit_email_log        gets a dedupe key (an e-mail with the same key is never sent twice) and the
--                              message / thread ids, so a reminder can be sent as a reply to the first mail
--  self_audit_mail_settings    an on/off switch per automatic mail (all start OFF)
--  self_audit_branch_contacts  each branch's service managers, who are copied on the self-audit mails
--  get_flagged_part_counts     how many parts / claims each branch has flagged to scrap in a cycle

alter table self_audit_email_log
  add column dedupe_key text,
  add column rfc_message_id text,
  add column thread_id text;

create unique index self_audit_email_log_dedupe on self_audit_email_log (dedupe_key) where status = 'sent' and dedupe_key is not null;

create table self_audit_mail_settings (
  key text primary key,
  enabled boolean not null default false,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into self_audit_mail_settings (key) values ('self_audit_reminder'), ('flagged_parts');
alter table self_audit_mail_settings enable row level security;
create policy "officers manage mail settings" on self_audit_mail_settings for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');

create table self_audit_branch_contacts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role text not null default 'service_manager' check (role in ('service_manager')),
  created_at timestamptz not null default now(),
  unique (branch_id, email)
);
alter table self_audit_branch_contacts enable row level security;
create policy "officers manage branch contacts" on self_audit_branch_contacts for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');

create or replace function public.get_flagged_part_counts(p_cycle_id uuid)
returns table (branch_id uuid, claims bigint, parts bigint)
language sql
stable
as $$
  select sr.branch_id, count(distinct sr.id), count(srp.id)
  from self_audit_scrap_requests sr
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id
  where sr.cycle_id = p_cycle_id and sr.status = 'pending'
  group by sr.branch_id;
$$;
revoke all on function public.get_flagged_part_counts(uuid) from public, anon, authenticated;
grant execute on function public.get_flagged_part_counts(uuid) to service_role;
