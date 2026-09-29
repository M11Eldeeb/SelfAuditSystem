-- get_already_scrapped_claims (migration 0044) only read self_audit_scrap_requests,
-- missing every 2024/2025 claim scrapped under the OLD pre-redesign manual
-- system (self_audit_scrapped_parts, ~46,274 distinct claims / 70,376 part
-- rows). Those claims are correctly excluded from run_generate_scrap_requests_all
-- (migration 0041's `not exists (select 1 from self_audit_scrapped_parts ...)`
-- guard) so they never get re-flagged as new scrap requests, but that also
-- meant they were invisible everywhere in the new Warranty Room UI - not
-- pending, not presumed_scrapped/scrapped, just missing. Union them in as
-- their own status so the branch admin's Already Scrapped list is complete.
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
        and sr.status in ('presumed_scrapped', 'scrapped')

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
    ) x
  ), '[]'::jsonb);
end;
$$;
