-- Replaces the plain waiting_for_submission boolean with the actual cycle
-- month each row belongs to (e.g. "2026-10") - more useful once there are
-- 3+ cycles with unresolved parts, where "waiting or not" alone can't tell
-- you how old the wait is.
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
      'repair_end_date', x.repair_end_date,
      'cycle_month', wrc.cycle_month
    ) order by wrc.cycle_month desc nulls last, x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    left join self_audit_warranty_room_cycles wrc on wrc.id = x.cycle_id
    where x.branch_id = p_branch_id
      and x.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
