-- Bug: release_scrap_requests_for_new_cycle (0054/0055) silently promoted
-- EVERY still-'pending' scrap request to 'presumed_scrapped' at every cycle
-- boundary - including ones the branch never submitted destroy evidence
-- for. presumed_scrapped counts as "already scrapped" (Scrapped List
-- excludes it from Flagged to be Scrapped), so a branch that simply missed
-- the deadline had its unsubmitted parts silently marked done. Officer
-- wants the opposite: if a branch didn't submit, those parts stay flagged
-- (still 'pending', still in Flagged to be Scrapped) and are visibly
-- marked as carried over/overdue, not quietly written off.
--
-- presumed_scrapped's only remaining use is what it was originally for
-- (migration 0043): the one-time historical backlog promotion, already
-- done. No function auto-promotes into it anymore.
drop function if exists public.release_scrap_requests_for_new_cycle();

-- flagged_at lets Flagged to be Scrapped tell "newly flagged this cycle"
-- from "carried over from an earlier cycle, still no destroy evidence" by
-- comparing it to the current open cycle's created_at - no extra state to
-- maintain, just sr.created_at carried through the cache.
alter table self_audit_already_scrapped_cache add column flagged_at timestamptz;

create or replace function public.refresh_already_scrapped_cache()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  truncate table self_audit_already_scrapped_cache;

  insert into self_audit_already_scrapped_cache
    (branch_id, claim_number, work_order_no, status, part_no, part_name, quantity, holding_period_days, first_submit_date, repair_end_date, submitted_at, flagged_at)
  select
    sr.branch_id, c.claim_number, sr.work_order_no, sr.status, srp.part_no, srp.part_name, srp.quantity,
    sr.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sr.submitted_at, sr.created_at
  from self_audit_scrap_requests sr
  join self_audit_claims c on c.id = sr.claim_id
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id

  union all

  select
    c.branch_id, c.claim_number, sp.work_order_no, 'scrapped_legacy', sp.part_no, sp.part_name, sp.quantity::integer,
    sp.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sp.created_at, null
  from self_audit_scrapped_parts sp
  join self_audit_claims c on c.id = sp.claim_id

  union all

  select
    sc.branch_id, coalesce(c.claim_number, scp.work_order_no, 'Unmatched'), scp.work_order_no, 'supplier_collected',
    scp.part_no, scp.part_name, scp.quantity, null::integer, c.raw_row->>'First Submit Date', c.repair_end_date, sc.handed_over_at, null
  from self_audit_supplier_collection_parts scp
  join self_audit_supplier_collections sc on sc.id = scp.collection_id
  left join self_audit_claims c on c.id = scp.claim_id
  where sc.status = 'handed_over';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_flagged_to_scrap_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current_cycle_started_at timestamptz;
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  select created_at into v_current_cycle_started_at
  from self_audit_audit_cycles
  where status = 'open'
  order by cycle_month desc
  limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'holding_period_days', x.holding_period_days,
      'first_submit_date', x.first_submit_date,
      'repair_end_date', x.repair_end_date,
      'waiting_for_submission', v_current_cycle_started_at is not null and x.flagged_at < v_current_cycle_started_at
    ) order by x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    where x.branch_id = p_branch_id
      and x.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
