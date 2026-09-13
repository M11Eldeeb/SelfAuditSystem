-- Scrap request workflow: branch submits a destruction video, the officer
-- reviews (return to branch / reject / submit to manufacturer), and on
-- escalation the officer records the manufacturer's decision (approve /
-- reject / return). Both status-changing steps go through a security
-- definer function so the "is this a valid transition from here" check and
-- the write happen atomically in one round trip, matching the pattern from
-- migration 0017 (save_internal_audit_claim_answers).

create or replace function public.submit_scrap_request(
  p_scrap_request_id uuid,
  p_video_path text
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
  if v_status not in ('pending_branch', 'returned_to_branch', 'manufacturer_returned') then
    raise exception 'This scrap request is not awaiting branch submission.';
  end if;
  if p_video_path is null or p_video_path = '' then
    raise exception 'A video is required before submitting.';
  end if;

  update self_audit_scrap_requests
  set status = 'pending_review', video_path = p_video_path, submitted_at = now()
  where id = p_scrap_request_id;

  insert into self_audit_scrap_request_events (scrap_request_id, event_type, actor_id, comment)
  values (p_scrap_request_id, 'branch_submitted', auth.uid(), null);
end;
$$;

create or replace function public.decide_scrap_request(
  p_scrap_request_id uuid,
  p_new_status text,
  p_comment text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_expected text[];
begin
  if current_user_role() <> 'officer' then
    raise exception 'Only an officer can decide a scrap request.';
  end if;

  if p_new_status in ('returned_to_branch', 'rejected', 'pending_manufacturer') then
    v_expected := array['pending_review'];
  elsif p_new_status in ('approved', 'manufacturer_rejected', 'manufacturer_returned') then
    v_expected := array['pending_manufacturer'];
  else
    raise exception 'Unknown status transition: %', p_new_status;
  end if;

  select status into v_status from self_audit_scrap_requests where id = p_scrap_request_id;
  if v_status is null then
    raise exception 'Scrap request not found.';
  end if;
  if not (v_status = any(v_expected)) then
    raise exception 'This scrap request is not in a state that allows that action (current status: %).', v_status;
  end if;

  update self_audit_scrap_requests set status = p_new_status where id = p_scrap_request_id;

  insert into self_audit_scrap_request_events (scrap_request_id, event_type, actor_id, comment)
  values (p_scrap_request_id, p_new_status, auth.uid(), p_comment);
end;
$$;
