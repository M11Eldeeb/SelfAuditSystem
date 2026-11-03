-- Open WIPs: a comment thread per WIP (everyone who sees the WIP can comment; each comment keeps its author and time).
-- The single note per WIP becomes the first comment.
create table if not exists self_audit_open_wip_comments (
  id uuid primary key default gen_random_uuid(),
  key text not null,                    -- "<Co>|<WIPNO>", as self_audit_open_wips.key (kept when the WIP leaves the report)
  body text not null,
  author_id uuid references self_audit_users(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists self_audit_open_wip_comments_key_idx on self_audit_open_wip_comments (key, created_at);
alter table self_audit_open_wip_comments enable row level security;

insert into self_audit_open_wip_comments (key, body, author_name, created_at)
select n.key, n.note, n.updated_by_name, n.updated_at from self_audit_open_wip_notes n
where not exists (select 1 from self_audit_open_wip_comments c where c.key = n.key);
