-- Read-only Google Sheets connection for the Prior Approvals tab of the officers' dashboard: the one connected Google
-- account's OAuth refresh token (scope spreadsheets.readonly). RLS on and NO policies: only the server's service role can
-- read or write it, exactly like self_audit_google_drive_connection.
create table if not exists public.self_audit_google_sheets_connection (
  id smallint primary key default 1 check (id = 1),
  refresh_token text not null,
  account_email text not null,
  connected_by uuid references public.self_audit_users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table public.self_audit_google_sheets_connection enable row level security;
