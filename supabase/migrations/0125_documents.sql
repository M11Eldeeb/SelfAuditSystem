-- Warranty and Technical Documents: the two Google Drive folders the warranty team keeps its documents in are shown in
-- the portal. The files stay in Drive (the source of truth); the portal reads them with one connected Google account
-- (self_audit_docs_connection, service role only) and keeps an index of both folder trees for fast browsing and search.
create table if not exists self_audit_docs_connection (
  id integer primary key default 1 check (id = 1),
  refresh_token text not null,
  account_email text not null,
  connected_by uuid references self_audit_users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table self_audit_docs_connection enable row level security;

create table if not exists self_audit_docs_index (
  drive_id text primary key,
  library text not null check (library in ('warranty', 'technical')),
  parent_id text,
  name text not null,
  mime_type text not null,
  is_folder boolean not null default false,
  size_bytes bigint,
  modified_at timestamptz,
  path text not null default '',
  synced_at timestamptz not null default now()
);
create index if not exists self_audit_docs_index_parent_idx on self_audit_docs_index (parent_id);
create index if not exists self_audit_docs_index_library_idx on self_audit_docs_index (library);
alter table self_audit_docs_index enable row level security;
create policy "signed-in users read the document index" on self_audit_docs_index for select using (auth.uid() is not null);

create table if not exists self_audit_docs_sync (
  id integer primary key default 1 check (id = 1),
  synced_at timestamptz,
  files integer,
  error text
);
alter table self_audit_docs_sync enable row level security;
