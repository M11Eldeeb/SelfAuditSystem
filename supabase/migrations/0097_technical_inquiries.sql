-- Technical Inquiries: a branch admin escalates a workshop problem to the technical team (two people, a new
-- "technical" login type). The workshop must confirm the terms first; the case then has a number (TI-0001),
-- the vehicle and fault details, attachments (kept in Google Drive, nothing in Supabase storage) and a comment
-- thread between the workshop and the technical team, who can close the case with a resolution.
--
--   status:  open               waiting for the technical team (new, or the workshop has replied)
--            awaiting_workshop  the technical team has answered / asked something
--            closed             closed with a resolution
--
-- Kept deliberately small (the database is on the free plan): attachments are only a Drive file id plus name,
-- type and size; the terms are versioned sets an inquiry points at, not copied text; few indexes.
-- Every write goes through the functions below (they check who may do what); the tables only allow reading.
-- (Applied to the live database in two steps, "technical_inquiries" then "technical_inquiries_slim"; this file
-- is the end result.)

alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text = 'branch_admin' and branch_id is not null) or role::text in ('officer', 'finance', 'technical')
);

-- Locked for branch admins until switched on (the same lock the Rejected Claims Diary used).
insert into self_audit_feature_flags (key, enabled) values ('technical_inquiries_branch_admins', false);

-- The terms a workshop confirms before submitting. An officer saves a new version when they change them; the
-- newest set is the current one, and an inquiry remembers which set it was confirmed against.
create table self_audit_inquiry_term_sets (
  id uuid primary key default gen_random_uuid(),
  terms text[] not null check (cardinality(terms) between 1 and 30),
  created_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table self_audit_inquiry_term_sets enable row level security;
create policy "everyone signed in reads the terms" on self_audit_inquiry_term_sets for select using (auth.uid() is not null);
create policy "officers add a new version of the terms" on self_audit_inquiry_term_sets for insert
  with check ((select current_user_role()::text) = 'officer');
-- Placeholders until the warranty team enters the real terms.
insert into self_audit_inquiry_term_sets (terms) values (array[
  'SAMPLE - replace with the real terms: the fault was checked and reproduced on the vehicle.',
  'SAMPLE - replace with the real terms: a full diagnostic scan was done and the report is attached.',
  'SAMPLE - replace with the real terms: the basic checks in the workshop manual were done.'
]);

create table self_audit_technical_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_no bigint generated always as identity unique,
  branch_id uuid not null references self_audit_branches (id),
  work_order_no text not null check (work_order_no = upper(btrim(work_order_no)) and char_length(work_order_no) between 1 and 40),
  vin text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  vehicle_model text not null check (char_length(btrim(vehicle_model)) between 1 and 80),
  fault_complaint text not null check (char_length(btrim(fault_complaint)) between 1 and 4000),
  actions_taken text not null check (char_length(btrim(actions_taken)) between 1 and 4000),
  workshop_comments text check (workshop_comments is null or char_length(workshop_comments) <= 4000),
  status text not null default 'open' check (status in ('open', 'awaiting_workshop', 'closed')),
  resolution text check (resolution is null or char_length(resolution) <= 4000),
  terms_set_id uuid not null references self_audit_inquiry_term_sets (id),
  created_by uuid references self_audit_users (id) on delete set null,
  created_by_name text,
  closed_by uuid references self_audit_users (id) on delete set null,
  closed_by_name text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index self_audit_technical_inquiries_status on self_audit_technical_inquiries (status, updated_at desc);
create index self_audit_technical_inquiries_branch on self_audit_technical_inquiries (branch_id, status);

create table self_audit_technical_inquiry_comments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references self_audit_technical_inquiries (id) on delete cascade,
  kind text not null default 'comment' check (kind in ('comment', 'closed', 'reopened')),
  author_id uuid references self_audit_users (id) on delete set null,
  author_name text,
  author_role text,
  body text check (body is null or char_length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index self_audit_technical_inquiry_comments_inquiry on self_audit_technical_inquiry_comments (inquiry_id, created_at);

create table self_audit_technical_inquiry_attachments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references self_audit_technical_inquiries (id) on delete cascade,
  comment_id uuid references self_audit_technical_inquiry_comments (id) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index self_audit_technical_inquiry_attachments_inquiry on self_audit_technical_inquiry_attachments (inquiry_id);

alter table self_audit_technical_inquiries enable row level security;
alter table self_audit_technical_inquiry_comments enable row level security;
alter table self_audit_technical_inquiry_attachments enable row level security;

create policy "read technical inquiries" on self_audit_technical_inquiries for select using (
  (select current_user_role()::text) in ('officer', 'technical')
  or ((select current_user_role()::text) = 'branch_admin'
      and branch_id = (select current_user_branch_id())
      and (select feature_enabled('technical_inquiries_branch_admins')))
);
create policy "read technical inquiry comments" on self_audit_technical_inquiry_comments for select using (
  exists (select 1 from self_audit_technical_inquiries i where i.id = inquiry_id)
);
create policy "read technical inquiry attachments" on self_audit_technical_inquiry_attachments for select using (
  exists (select 1 from self_audit_technical_inquiries i where i.id = inquiry_id)
);

create or replace function public.inquiry_actor()
returns table (user_id uuid, role text, name text, branch_id uuid)
language sql stable security definer set search_path = public
as $$
  select u.id, u.role::text, coalesce(nullif(btrim(u.full_name), ''), u.email), u.branch_id
  from self_audit_users u where u.id = auth.uid();
$$;
revoke all on function public.inquiry_actor() from public, anon;
grant execute on function public.inquiry_actor() to authenticated;

-- Adds the Drive files an upload batch brought (a jsonb list of {driveFileId, name, type, size}).
create or replace function public.add_inquiry_attachments(p_inquiry_id uuid, p_comment_id uuid, p_user uuid, p_files jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare f jsonb;
begin
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then raise exception 'Attachments must be a list.'; end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) + (select count(*) from self_audit_technical_inquiry_attachments where inquiry_id = p_inquiry_id) > 60 then
    raise exception 'Too many attachments on this inquiry.';
  end if;
  for f in select value from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if coalesce(f->>'driveFileId', '') = '' then raise exception 'Invalid attachment.'; end if;
    insert into self_audit_technical_inquiry_attachments (inquiry_id, comment_id, drive_file_id, file_name, mime_type, size_bytes, uploaded_by)
    values (p_inquiry_id, p_comment_id, f->>'driveFileId', f->>'name', f->>'type', (f->>'size')::bigint, p_user);
  end loop;
end;
$$;
revoke all on function public.add_inquiry_attachments(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.create_technical_inquiry(
  p_id uuid, p_branch_id uuid, p_work_order text, p_vin text, p_model text, p_fault text, p_actions text,
  p_comments text, p_terms_confirmed boolean, p_attachments jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare a record; v_no bigint; v_set uuid;
begin
  select * into a from inquiry_actor();
  if a.user_id is null then raise exception 'Please sign in again.'; end if;
  if a.role = 'branch_admin' then
    if p_branch_id is distinct from a.branch_id then raise exception 'You can only submit for your own branch.'; end if;
    if not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Technical Inquiries is coming soon for branch admins.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'You cannot submit a technical inquiry.';
  end if;
  if p_terms_confirmed is not true then raise exception 'Confirm all the terms before submitting.'; end if;
  select id into v_set from self_audit_inquiry_term_sets order by created_at desc limit 1;

  insert into self_audit_technical_inquiries
    (id, branch_id, work_order_no, vin, vehicle_model, fault_complaint, actions_taken, workshop_comments, terms_set_id, created_by, created_by_name)
  values
    (p_id, p_branch_id, upper(btrim(p_work_order)), upper(btrim(p_vin)), btrim(p_model), btrim(p_fault), btrim(p_actions),
     nullif(btrim(coalesce(p_comments, '')), ''), v_set, a.user_id, a.name)
  returning inquiry_no into v_no;
  perform add_inquiry_attachments(p_id, null, a.user_id, p_attachments);
  return v_no;
end;
$$;

create or replace function public.technical_inquiry_comment(p_id uuid, p_inquiry_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_new text;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role = 'branch_admin' then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role not in ('officer', 'technical') then
    raise exception 'Not allowed.';
  end if;
  if r.status = 'closed' then raise exception 'This inquiry is closed. Ask the technical team to reopen it.'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Write your comment.'; end if;

  v_new := case when a.role = 'branch_admin' then 'open' else 'awaiting_workshop' end;
  update self_audit_technical_inquiries set status = v_new, updated_at = now() where id = r.id;
  insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body)
  values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body));
  perform add_inquiry_attachments(r.id, p_id, a.user_id, p_attachments);
  return v_new;
end;
$$;

create or replace function public.close_technical_inquiry(p_inquiry_id uuid, p_resolution text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_res text := btrim(coalesce(p_resolution, ''));
begin
  select * into a from inquiry_actor();
  if a.role not in ('officer', 'technical') then raise exception 'Only the technical team can close an inquiry.'; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if r.status = 'closed' then raise exception 'This inquiry is already closed.'; end if;
  if v_res = '' then raise exception 'Write a short summary of the solution before closing.'; end if;

  update self_audit_technical_inquiries
  set status = 'closed', resolution = v_res, closed_by = a.user_id, closed_by_name = a.name, closed_at = now(), updated_at = now()
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'closed', a.user_id, a.name, a.role, v_res);
end;
$$;

create or replace function public.reopen_technical_inquiry(p_inquiry_id uuid, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  if a.role not in ('officer', 'technical') then raise exception 'Only the technical team can reopen an inquiry.'; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if r.status <> 'closed' then raise exception 'This inquiry is not closed.'; end if;
  update self_audit_technical_inquiries
  set status = 'awaiting_workshop', closed_by = null, closed_by_name = null, closed_at = null, updated_at = now()
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'reopened', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_comment, '')), ''));
end;
$$;

revoke all on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, boolean, jsonb) from public, anon;
revoke all on function public.technical_inquiry_comment(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.close_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.reopen_technical_inquiry(uuid, text) from public, anon;
grant execute on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.technical_inquiry_comment(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.close_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.reopen_technical_inquiry(uuid, text) to authenticated;

-- Test account "a@a" (branch admin) can use it while it is locked for everyone else.
update self_audit_feature_flags set enabled_for = enabled_for || array['897354ed-05df-4f80-95a3-3005f454c3c1'::uuid] where key = 'technical_inquiries_branch_admins';
