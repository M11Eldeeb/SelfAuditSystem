-- Branch admins send feedback (subject, message, up to 3 photo/PDF/video
-- attachments of at most 10 MB each) to the warranty officers, who read it,
-- reply (the sender sees the reply) and delete it to free storage.
--
--   self_audit_feedback              the message; officer_seen_at null = unread by officers
--   self_audit_feedback_attachments  files in the private 'feedback-files' bucket
--   self_audit_feedback_replies      officer replies; sender_seen_at null = unread by the sender
--
-- The two unread markers drive the notification bell for each side.

create table self_audit_feedback (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references self_audit_users (id) on delete cascade,
  branch_id uuid references self_audit_branches (id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  officer_seen_at timestamptz
);
create index self_audit_feedback_sender_idx on self_audit_feedback (sender_id, created_at desc);
create index self_audit_feedback_created_idx on self_audit_feedback (created_at desc);
create index self_audit_feedback_unseen_idx on self_audit_feedback (created_at) where officer_seen_at is null;

create table self_audit_feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references self_audit_feedback (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index self_audit_feedback_attachments_feedback_idx on self_audit_feedback_attachments (feedback_id);

create table self_audit_feedback_replies (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references self_audit_feedback (id) on delete cascade,
  author_id uuid references self_audit_users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  sender_seen_at timestamptz
);
create index self_audit_feedback_replies_feedback_idx on self_audit_feedback_replies (feedback_id, created_at);
create index self_audit_feedback_replies_unseen_idx on self_audit_feedback_replies (feedback_id) where sender_seen_at is null;

alter table self_audit_feedback enable row level security;
alter table self_audit_feedback_attachments enable row level security;
alter table self_audit_feedback_replies enable row level security;

-- Officers: everything. is distinct from, not <>, so a NULL role is denied.
create policy "officers manage feedback" on self_audit_feedback for all
  using ((select current_user_role()) is not distinct from 'officer')
  with check ((select current_user_role()) is not distinct from 'officer');
create policy "officers manage feedback attachments" on self_audit_feedback_attachments for all
  using ((select current_user_role()) is not distinct from 'officer')
  with check ((select current_user_role()) is not distinct from 'officer');
create policy "officers manage feedback replies" on self_audit_feedback_replies for all
  using ((select current_user_role()) is not distinct from 'officer')
  with check ((select current_user_role()) is not distinct from 'officer');

-- Branch admins: send, and read only their own thread.
create policy "branch admins send feedback" on self_audit_feedback for insert
  with check (
    sender_id = (select auth.uid())
    and (select current_user_role()) is not distinct from 'branch_admin'
    and branch_id is not distinct from (select current_user_branch_id())
  );
create policy "branch admins read own feedback" on self_audit_feedback for select
  using (sender_id = (select auth.uid()));

create policy "branch admins add attachments to own feedback" on self_audit_feedback_attachments for insert
  with check (exists (
    select 1 from self_audit_feedback f where f.id = feedback_id and f.sender_id = (select auth.uid())
  ));
create policy "branch admins read own feedback attachments" on self_audit_feedback_attachments for select
  using (exists (
    select 1 from self_audit_feedback f where f.id = feedback_id and f.sender_id = (select auth.uid())
  ));

create policy "branch admins read replies to own feedback" on self_audit_feedback_replies for select
  using (exists (
    select 1 from self_audit_feedback f where f.id = feedback_id and f.sender_id = (select auth.uid())
  ));

-- Marking as seen goes through functions so a branch admin can flip only the
-- sender_seen_at of replies on their own feedback, and nothing else.
create or replace function public.mark_feedback_seen_by_officer(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;
  update self_audit_feedback set officer_seen_at = now() where id = p_feedback_id and officer_seen_at is null;
end;
$$;

create or replace function public.mark_feedback_replies_seen(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update self_audit_feedback_replies r
  set sender_seen_at = now()
  where r.feedback_id = p_feedback_id
    and r.sender_seen_at is null
    and exists (select 1 from self_audit_feedback f where f.id = p_feedback_id and f.sender_id = auth.uid());
end;
$$;

revoke all on function public.mark_feedback_seen_by_officer(uuid) from public, anon;
revoke all on function public.mark_feedback_replies_seen(uuid) from public, anon;
grant execute on function public.mark_feedback_seen_by_officer(uuid) to authenticated;
grant execute on function public.mark_feedback_replies_seen(uuid) to authenticated;

-- Private bucket, 10 MB per file, photos / PDFs / videos only. Files live at
-- {sender user id}/{feedback id}/{file}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-files', 'feedback-files', false, 10485760, array['image/*', 'application/pdf', 'video/*']);

create policy "branch admins upload own feedback files" on storage.objects for insert
  with check (
    bucket_id = 'feedback-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select current_user_role()) is not distinct from 'branch_admin'
  );
create policy "branch admins read own feedback files" on storage.objects for select
  using (bucket_id = 'feedback-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "branch admins delete own feedback files" on storage.objects for delete
  using (bucket_id = 'feedback-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "officers manage feedback files" on storage.objects for all
  using (bucket_id = 'feedback-files' and (select current_user_role()) is not distinct from 'officer')
  with check (bucket_id = 'feedback-files' and (select current_user_role()) is not distinct from 'officer');
