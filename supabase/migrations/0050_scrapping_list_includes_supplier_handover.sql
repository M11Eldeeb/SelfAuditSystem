-- "any supplier parts marked as sent, you auto put their parts on the
-- scrapping list" - a part the manufacturer's supplier already collected is
-- gone the same way a scrapped part is gone, so it belongs on the same
-- report. Adds a third union branch: supplier_collection_parts whose
-- collection has been handed_over.
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
    from (
      select
        c.claim_number,
        sr.work_order_no,
        sr.status,
        srp.part_no,
        srp.part_name,
        srp.quantity,
        sr.holding_period_days,
        c.raw_row->>'First Submit Date' as first_submit_date,
        c.repair_end_date,
        sr.submitted_at
      from self_audit_scrap_requests sr
      join self_audit_claims c on c.id = sr.claim_id
      left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id
      where sr.branch_id = p_branch_id

      union all

      select
        c.claim_number,
        sp.work_order_no,
        'scrapped_legacy' as status,
        sp.part_no,
        sp.part_name,
        sp.quantity::integer,
        sp.holding_period_days,
        c.raw_row->>'First Submit Date' as first_submit_date,
        c.repair_end_date,
        sp.created_at as submitted_at
      from self_audit_scrapped_parts sp
      join self_audit_claims c on c.id = sp.claim_id
      where c.branch_id = p_branch_id

      union all

      select
        coalesce(c.claim_number, scp.work_order_no, 'Unmatched'),
        scp.work_order_no,
        'supplier_collected' as status,
        scp.part_no,
        scp.part_name,
        scp.quantity,
        null::integer as holding_period_days,
        c.raw_row->>'First Submit Date' as first_submit_date,
        c.repair_end_date,
        sc.handed_over_at as submitted_at
      from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      left join self_audit_claims c on c.id = scp.claim_id
      where sc.branch_id = p_branch_id
        and sc.status = 'handed_over'
    ) x
  ), '[]'::jsonb);
end;
$$;
