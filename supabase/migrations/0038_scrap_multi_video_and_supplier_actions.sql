-- A destruction video no longer has to be a single file - the branch might
-- film it in several clips. One scrap_request now has many videos instead
-- of one video_path column (0 existing rows have video_path set, confirmed
-- live, so nothing to migrate).
create table public.self_audit_scrap_request_videos (
  id uuid primary key default gen_random_uuid(),
  scrap_request_id uuid not null references public.self_audit_scrap_requests (id) on delete cascade,
  video_path text not null,
  created_at timestamptz not null default now()
);
create index self_audit_scrap_request_videos_request_idx on public.self_audit_scrap_request_videos (scrap_request_id);

alter table public.self_audit_scrap_request_videos enable row level security;

create policy "officers manage scrap_request_videos"
  on public.self_audit_scrap_request_videos
  for all
  using (current_user_role() = 'officer'::user_role)
  with check (current_user_role() = 'officer'::user_role);

create policy "branch admins read own scrap_request_videos"
  on public.self_audit_scrap_request_videos
  for select
  using (
    exists (
      select 1 from self_audit_scrap_requests r
      where r.id = self_audit_scrap_request_videos.scrap_request_id
        and r.branch_id = current_user_branch_id()
    )
  );

alter table public.self_audit_scrap_requests drop column video_path;

create or replace function public.submit_scrap_request(
  p_scrap_request_id uuid,
  p_video_paths text[]
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() <> 'branch_admin' then
    raise exception 'Only a branch admin can submit a scrap request.';
  end if;

  select status, branch_id into v_status, v_branch_id
  from self_audit_scrap_requests where id = p_scrap_request_id;

  if v_status is null then
    raise exception 'Scrap request not found.';
  end if;
  if v_branch_id is distinct from current_user_branch_id() then
    raise exception 'This scrap request does not belong to your branch.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This scrap request is not awaiting branch submission.';
  end if;
  if p_video_paths is null or array_length(p_video_paths, 1) is null then
    raise exception 'At least one video is required before submitting.';
  end if;

  update self_audit_scrap_requests
  set status = 'scrapped', submitted_at = now()
  where id = p_scrap_request_id;

  insert into self_audit_scrap_request_videos (scrap_request_id, video_path)
  select p_scrap_request_id, v from unnest(p_video_paths) as v;

  insert into self_audit_scrap_request_events (scrap_request_id, event_type, actor_id, comment)
  values (p_scrap_request_id, 'branch_submitted', auth.uid(), null);
end;
$$;

-- Officer no longer has to go through the full branch/supplier signature
-- ceremony to close out a pending supplier collection - a plain status
-- update they already have RLS rights for ("officers manage
-- supplier_collections", ALL). No new RPC needed for this or for delete
-- (plain DELETE, same policy, cascades to collection_parts).
