-- The automatic e-mails become editable from Settings -> Email settings.
--
--  self_audit_mail_templates  what an officer changed for one mail: subject, body, who is copied and extra
--                             addresses, plus numbers such as the reminder days. No row = the built-in wording.
--  self_audit_mail_lists      the standing contact lists (the warranty head, the standing managers), editable.

create table self_audit_mail_templates (
  key text primary key,
  subject text,
  body text,
  cc_groups text[],
  extra_to text[] not null default '{}',
  extra_cc text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table self_audit_mail_templates enable row level security;
create policy "officers manage mail templates" on self_audit_mail_templates for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');

create table self_audit_mail_lists (
  key text primary key check (key in ('warranty_head', 'standing_managers')),
  emails text[] not null default '{}',
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table self_audit_mail_lists enable row level security;
create policy "officers manage mail lists" on self_audit_mail_lists for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');

insert into self_audit_mail_lists (key, emails) values
  ('warranty_head', array['mustafa.nasr@jiadmotors.com']),
  ('standing_managers', array[
    'ahmed.gomaa@jiadmotors.com', 'ahmed.hablil@jiadmotors.com', 'saleh.ismail@jiadmotors.com',
    'osman.ahmed@jiadmotors.com', 'ahmed.nader@jiadmotors.com', 'adil.almakhlafi@jiadmotors.com', 'rami.kamli@jiadmotors.com'
  ]);
