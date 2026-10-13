-- The portal can send e-mail itself through Gmail (a company mailbox signs in once, an officer
-- connects it). Two tables:
--   self_audit_email_connection  the one connected sender mailbox (its OAuth refresh token).
--                                RLS on and NO policies: only the server's service role can read it.
--   self_audit_email_log         every e-mail the portal tried to send (who for, what, result), so
--                                a reminder can be checked and never goes out twice by accident.

create table self_audit_email_connection (
  id smallint primary key default 1 check (id = 1),
  refresh_token text not null,
  account_email text not null,
  connected_by uuid references self_audit_users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table self_audit_email_connection enable row level security;

create table self_audit_email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  recipients text[] not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  gmail_message_id text,
  sent_by uuid references self_audit_users (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index self_audit_email_log_kind_sent_at on self_audit_email_log (kind, sent_at desc);
alter table self_audit_email_log enable row level security;

create policy "officers read the email log" on self_audit_email_log for select
  using ((select current_user_role()) = 'officer');
