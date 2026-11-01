-- Flagged to be scrapped: the VIN of each claim (in the cache and the list).
alter table self_audit_already_scrapped_cache add column if not exists vin text;

create or replace function public.refresh_already_scrapped_cache()
 returns integer
 language plpgsql
as $function$
declare
  v_count integer;
begin
  if not cache_needs_refresh('already_scrapped', array[
    'self_audit_claims', 'self_audit_scrap_requests', 'self_audit_scrap_request_parts', 'self_audit_scrapped_parts',
    'self_audit_supplier_collection_parts', 'self_audit_supplier_collections']) then
    return -1;
  end if;

  delete from self_audit_already_scrapped_cache;

  insert into self_audit_already_scrapped_cache
    (branch_id, claim_number, work_order_no, status, part_no, part_name, quantity, holding_period_days, first_submit_date, repair_end_date, submitted_at, flagged_at, cycle_id, vin)
  select
    sr.branch_id, c.claim_number, sr.work_order_no, sr.status, srp.part_no, srp.part_name, srp.quantity,
    sr.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sr.submitted_at, sr.created_at, sr.cycle_id, c.vin
  from self_audit_scrap_requests sr
  join self_audit_claims c on c.id = sr.claim_id
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id

  union all

  select
    c.branch_id, c.claim_number, sp.work_order_no, 'scrapped_legacy', sp.part_no, sp.part_name, sp.quantity::integer,
    sp.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sp.created_at, null, null, c.vin
  from self_audit_scrapped_parts sp
  join self_audit_claims c on c.id = sp.claim_id

  union all

  select
    sc.branch_id, coalesce(c.claim_number, scp.work_order_no, 'Unmatched'), scp.work_order_no, 'supplier_collected',
    scp.part_no, scp.part_name, scp.quantity, null::integer, c.raw_row->>'First Submit Date', c.repair_end_date, sc.handed_over_at, null, null, coalesce(c.vin, scp.vin)
  from self_audit_supplier_collection_parts scp
  join self_audit_supplier_collections sc on sc.id = scp.collection_id
  left join self_audit_claims c on c.id = scp.claim_id
  where sc.status = 'handed_over';

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;


create or replace function public.get_flagged_to_scrap_claims(p_branch_id uuid, p_cycle_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      and (p_cycle_id is null or x.cycle_id = p_cycle_id)
  ), '[]'::jsonb);
end;
$function$;

-- Rebuild the cache at the next run so the VINs fill in.
delete from self_audit_cache_fingerprints where cache_name = 'already_scrapped';
