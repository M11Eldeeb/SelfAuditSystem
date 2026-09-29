-- current_user_role() returns NULL for an unauthenticated/anon caller (no
-- matching self_audit_users row for auth.uid() = null). Every one of these
-- functions gated itself with `current_user_role() <> 'x'` - in SQL,
-- `null <> 'x'` evaluates to null, and `if null then ... end if` in plpgsql
-- treats null as false, so the raise exception is silently skipped and the
-- function runs anyway. Confirmed live: calling promote_stale_scrap_requests
-- (migration 0043/0045, same bug) with only the public anon key returned 200
-- instead of being rejected.
--
-- Two of the six functions using this pattern happen to be protected anyway
-- by an unrelated downstream `is distinct from` branch-ownership check
-- (hand_over_supplier_collection, submit_scrap_request x2) - still fixed
-- here for consistency and defense in depth. The other three had NO such
-- downstream check: get_warranty_room_excluded_claim_ids leaked claim ids to
-- anon, and - most seriously - finish_claims_upload let anon trigger a real
-- DELETE from self_audit_claims for any batch id, and promote_stale_scrap_requests
-- (introduced this session, and its own "fix" in 0045 kept the same bug)
-- let anon mass-hide real pending scrap requests from branch admins.
create or replace function public.promote_stale_scrap_requests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  with promoted as (
    update self_audit_scrap_requests
    set status = 'presumed_scrapped'
    where status = 'pending'
    returning id
  )
  select count(*)::integer into v_count from promoted;

  return v_count;
end;
$$;

create or replace function public.get_warranty_room_excluded_claim_ids()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(distinct claim_id) from (
      select claim_id from self_audit_scrap_requests
      union
      select claim_id from self_audit_scrapped_parts where claim_id is not null
      union
      select scp.claim_id
      from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      where sc.status = 'handed_over' and scp.claim_id is not null
    ) excluded(claim_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.finish_claims_upload(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted_count integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  with batch_branches as (
    select distinct branch_id
    from self_audit_claims
    where upload_batch_id = p_batch_id
  ),
  stale as (
    select c.id
    from self_audit_claims c
    where c.upload_batch_id is distinct from p_batch_id
      and c.branch_id in (select branch_id from batch_branches)
      and not exists (
        select 1 from self_audit_audit_assignments a where a.claim_id = c.id
      )
  )
  delete from self_audit_claims
  where id in (select id from stale);

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

create or replace function public.hand_over_supplier_collection(p_collection_id uuid, p_branch_rep_name text, p_supplier_rep_name text, p_signed_pdf_path text, p_video_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() is distinct from 'branch_admin' then
    raise exception 'Only a branch admin can hand over a supplier collection.';
  end if;

  select status, branch_id into v_status, v_branch_id
  from self_audit_supplier_collections where id = p_collection_id;

  if v_status is null then
    raise exception 'Supplier collection not found.';
  end if;
  if v_branch_id is distinct from current_user_branch_id() then
    raise exception 'This collection does not belong to your branch.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This collection has already been handed over.';
  end if;
  if p_branch_rep_name is null or trim(p_branch_rep_name) = '' then
    raise exception 'Enter the branch representative name.';
  end if;
  if p_supplier_rep_name is null or trim(p_supplier_rep_name) = '' then
    raise exception 'Enter the supplier representative name.';
  end if;
  if p_signed_pdf_path is null or p_signed_pdf_path = '' then
    raise exception 'Upload the signed document.';
  end if;
  if p_video_path is null or p_video_path = '' then
    raise exception 'Upload a video.';
  end if;

  update self_audit_supplier_collections
  set status = 'handed_over', branch_rep_name = p_branch_rep_name, supplier_rep_name = p_supplier_rep_name,
      signed_pdf_path = p_signed_pdf_path, video_path = p_video_path,
      handed_over_at = now(), handed_over_by = auth.uid()
  where id = p_collection_id;
end;
$$;

create or replace function public.submit_scrap_request(p_scrap_request_id uuid, p_video_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() is distinct from 'branch_admin' then
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
  if p_video_path is null or p_video_path = '' then
    raise exception 'A video is required before submitting.';
  end if;

  update self_audit_scrap_requests
  set status = 'scrapped', video_path = p_video_path, submitted_at = now()
  where id = p_scrap_request_id;

  insert into self_audit_scrap_request_events (scrap_request_id, event_type, actor_id, comment)
  values (p_scrap_request_id, 'branch_submitted', auth.uid(), null);
end;
$$;

create or replace function public.submit_scrap_request(p_scrap_request_id uuid, p_video_paths text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() is distinct from 'branch_admin' then
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
