-- Adds "Draft saved" to the do-not-scrap status exclusions (alongside
-- Closed / Rejected / Returned from chief agent without a verification
-- date) - a draft claim isn't a real settled warranty case yet.
create or replace function public.get_do_not_scrap_claims(p_branch_id uuid)
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
      'vin', x.vin,
      'vehicle_series', x.vehicle_series,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'creation_date', x.creation_date,
      'repair_end_date', x.repair_end_date,
      'first_submit_date', x.first_submit_date,
      'holding_period_days', x.holding_period_days
    ) order by x.creation_date desc, x.claim_number, x.part_no nulls last)
    from (
      select
        c.claim_number,
        c.work_order_no,
        c.vin,
        c.raw_row->>'Vehicle Series' as vehicle_series,
        cp.part_no,
        coalesce(cp.part_name, c.main_part_name) as part_name,
        cp.quantity,
        c.creation_date,
        c.repair_end_date,
        c.raw_row->>'First Submit Date' as first_submit_date,
        case
          when (c.raw_row->>'Verification Date') ~ '^\d{4}-\d{2}-\d{2}'
          then current_date - substring(c.raw_row->>'Verification Date' from 1 for 10)::date
          else null
        end as holding_period_days
      from self_audit_claims c
      left join self_audit_claim_parts cp on cp.claim_id = c.id
      where c.branch_id = p_branch_id
        and c.has_parts = true
        and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
        and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
        and c.raw_row->>'Status' is distinct from 'Closed'
        and c.raw_row->>'Status' is distinct from 'Rejected'
        and c.raw_row->>'Status' is distinct from 'Draft saved'
        and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null)
    ) x
  ), '[]'::jsonb);
end;
$$;
