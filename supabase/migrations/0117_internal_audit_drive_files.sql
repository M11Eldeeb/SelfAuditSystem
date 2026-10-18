-- Internal audit files on the company Google Drive:
-- Internal Audit / <branch> / <MM-YYYY of the audit date>. The officer
-- uploads working files (photos, sheets, PDFs) from the audit page, and the
-- finalized audit's result PDF is saved there automatically ("report").
create table if not exists self_audit_internal_audit_files (
  id uuid primary key default gen_random_uuid(),
  internal_audit_id uuid not null references self_audit_internal_audits (id) on delete cascade,
  kind text not null default 'attachment' check (kind in ('attachment', 'report')),
  drive_file_id text not null,
  drive_url text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists self_audit_internal_audit_files_audit_idx on self_audit_internal_audit_files (internal_audit_id, kind);
-- One result PDF per audit (re-uploads replace its content in place).
create unique index if not exists self_audit_internal_audit_files_one_report on self_audit_internal_audit_files (internal_audit_id) where kind = 'report';

alter table self_audit_internal_audit_files enable row level security;
create policy "officers manage internal_audit_files" on self_audit_internal_audit_files for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');
