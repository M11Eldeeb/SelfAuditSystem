-- Officer confirmed: real approve/reject on destroy evidence (not just
-- download-and-done), generic per-branch multi-video (no per-part video
-- linkage). Approving a branch's submission moves ALL of that branch's
-- currently-pending scrap_requests to 'scrapped' - the missing link that
-- made "Mark as sent" a no-op against the Scrapping List until now.
-- Reject is the existing "Return" button (reverts destroy_evidence to
-- pending, touches nothing else since nothing was ever moved).
create or replace function public.approve_destroy_evidence(p_cycle_id uuid, p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_scrapped_count integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  select status into v_status from self_audit_destroy_evidence where cycle_id = p_cycle_id and branch_id = p_branch_id;
  if v_status is null then
    raise exception 'Destroy evidence not found.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'This submission is not awaiting approval.';
  end if;

  with scrapped as (
    update self_audit_scrap_requests
    set status = 'scrapped', submitted_at = now()
    where branch_id = p_branch_id and status = 'pending'
    returning id
  )
  select count(*) into v_scrapped_count from scrapped;

  update self_audit_destroy_evidence
  set status = 'sent', sent_at = now(), sent_by = auth.uid()
  where cycle_id = p_cycle_id and branch_id = p_branch_id;

  return v_scrapped_count;
end;
$$;

-- Splits the old single "Scrapping List" into the two folders the officer
-- described: Scrapped List (done - presumed_scrapped/scrapped/legacy/
-- supplier_collected) and Flagged to be scrapped (pending - awaiting branch
-- destroy evidence + officer approval). Both read the same cache table
-- (0051), just filtered differently - no change to how the cache is built
-- or refreshed.
create or replace function public.get_already_scrapped_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'status', x.status,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'holding_period_days', x.holding_period_days,
      'first_submit_date', x.first_submit_date,
      'repair_end_date', x.repair_end_date,
      'submitted_at', x.submitted_at
    ) order by x.submitted_at desc nulls last, x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    where x.branch_id = p_branch_id
      and x.status <> 'pending'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_flagged_to_scrap_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'holding_period_days', x.holding_period_days,
      'first_submit_date', x.first_submit_date,
      'repair_end_date', x.repair_end_date
    ) order by x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    where x.branch_id = p_branch_id
      and x.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
