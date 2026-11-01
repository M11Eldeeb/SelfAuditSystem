-- Scrap list generation never finished: it read the whole claims table with raw_row (~200 MB) page by page and ran
-- claim_part_lines over every claim, hitting the 2-minute statement limit; the request stayed "queued" (a timeout is
-- not caught by "when others"), so it was retried every minute and kept the database busy.
--
-- Now the eligible claims are found first on narrow columns (status from self_audit_claim_settlement - the same value
-- as raw_row 'Status', kept by trigger; verification_date is the parsed 'Verification Date'), and parts / raw_row are
-- read only for those claims. Same rules as before.

create or replace function public.run_generate_scrap_requests_all()
 returns integer
 language plpgsql
as $function$
declare
  v_total_created integer := 0;
  v_cycle_id uuid;
begin
  select id into v_cycle_id from self_audit_warranty_room_cycles order by cycle_month desc limit 1;

  create temporary table tmp_scrap_candidates_base on commit drop as
  select c.id as claim_id, c.branch_id, c.work_order_no, c.labor_code as main_labor_code, c.verification_date as settlement_date,
         (current_date - c.verification_date) as holding_period_days, c.main_part_name
  from self_audit_claims c
  join self_audit_claim_settlement s on s.claim_id = c.id
  join self_audit_branches br on br.id = c.branch_id and br.active = true
  where c.has_parts = true
    and c.verification_date is not null
    and c.verification_date < (current_date - 90)
    and lower(s.status) in ('approved', 'settled', 'to be settled')
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
    and not exists (
      select 1 from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      where scp.claim_id = c.id and sc.status = 'handed_over'
    );

  create temporary table tmp_page_parts on commit drop as
  select * from claim_part_lines((select array_agg(claim_id) from tmp_scrap_candidates_base));

  create temporary table tmp_scrap_candidates on commit drop as
  select
    b.claim_id, b.branch_id, b.work_order_no, b.main_labor_code, b.settlement_date, b.holding_period_days,
    coalesce(
      (select jsonb_agg(jsonb_build_object('part_no', pp.part_no, 'part_name', pp.part_name, 'quantity', pp.quantity))
       from tmp_page_parts pp where pp.claim_id = b.claim_id),
      (select case when b.main_part_name is not null or (c.raw_row->>'Main Part') is not null
         then jsonb_build_array(jsonb_build_object(
           'part_no', coalesce(c.raw_row->>'Main Part', c.raw_row->>'Part Number', c.raw_row->>'Part No', c.raw_row->>'Part Code'),
           'part_name', b.main_part_name,
           'quantity', null
         ))
         else '[]'::jsonb end
       from self_audit_claims c where c.id = b.claim_id)
    ) as candidate_parts
  from tmp_scrap_candidates_base b;

  create temporary table tmp_scrap_requests on commit drop as
  select
    t.claim_id, t.branch_id, t.work_order_no, t.main_labor_code, t.settlement_date, t.holding_period_days,
    (
      select jsonb_agg(part) from jsonb_array_elements(t.candidate_parts) part
      where not exists (
        select 1 from self_audit_supplier_collection_parts scp
        join self_audit_supplier_collections sc on sc.id = scp.collection_id
        where scp.claim_id = t.claim_id and scp.part_no = part->>'part_no'
          and sc.status = 'pending'
          and (sc.collection_date is null or sc.collection_date >= current_date)
      )
    ) as remaining_parts
  from tmp_scrap_candidates t;

  with ins as (
    insert into self_audit_scrap_requests (claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, status, cycle_id)
    select claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, 'pending', v_cycle_id
    from tmp_scrap_requests
    where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0
    on conflict (claim_id) do nothing
    returning id, claim_id
  )
  insert into self_audit_scrap_request_parts (scrap_request_id, part_no, part_name, quantity)
  select ins.id, p->>'part_no', p->>'part_name', nullif(p->>'quantity', '')::integer
  from ins
  join tmp_scrap_requests t on t.claim_id = ins.claim_id
  cross join lateral jsonb_array_elements(t.remaining_parts) p
  where p->>'part_no' is not null;

  select count(*) into v_total_created from tmp_scrap_requests
  where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0;

  drop table tmp_scrap_candidates_base;
  drop table tmp_page_parts;
  drop table tmp_scrap_candidates;
  drop table tmp_scrap_requests;

  perform scrap_closed_branch_claims();

  return v_total_created;
end;
$function$;

-- Closed branches: same rules, status / verification date from the narrow columns (no raw_row scan).
create or replace function public.scrap_closed_branch_claims()
 returns integer
 language plpgsql
as $function$
declare
  v_converted integer;
  v_added integer;
begin
  update self_audit_scrap_requests sr
  set status = 'scrapped', submitted_at = coalesce(sr.submitted_at, now())
  from self_audit_branches b
  where b.id = sr.branch_id and b.active = false and sr.status = 'pending';
  get diagnostics v_converted = row_count;

  with eligible as (
    select c.id, c.branch_id, c.work_order_no, c.labor_code, c.verification_date
    from self_audit_claims c
    join self_audit_branches b on b.id = c.branch_id and b.active = false
    left join self_audit_claim_settlement s on s.claim_id = c.id
    where c.has_parts = true
      and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
      and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
      and not exists (
        select 1 from self_audit_supplier_collection_parts scp
        join self_audit_supplier_collections sc on sc.id = scp.collection_id
        where scp.claim_id = c.id
          and (sc.status = 'handed_over' or (sc.status = 'pending' and (sc.collection_date is null or sc.collection_date >= current_date)))
      )
      and s.status is distinct from 'Closed'
      and coalesce(s.status, '') not ilike '%reject%'
      and s.status is distinct from 'Draft saved'
      and not (s.status = 'Returned from chief agent' and c.verification_date is null)
  ),
  ins as (
    insert into self_audit_scrap_requests (claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, status, submitted_at)
    select e.id, e.branch_id, e.work_order_no, e.labor_code, e.verification_date,
           case when e.verification_date is not null then current_date - e.verification_date end, 'scrapped', now()
    from eligible e
    on conflict (claim_id) do nothing
    returning id, claim_id
  ),
  parts as (
    insert into self_audit_scrap_request_parts (scrap_request_id, part_no, part_name, quantity)
    select ins.id, p.part_no, p.part_name, round(p.quantity)::integer
    from ins
    join claim_part_lines((select array_agg(claim_id) from ins)) p on p.claim_id = ins.claim_id
    where p.part_no is not null
    returning 1
  )
  select count(*) into v_added from ins;

  return v_converted + v_added;
end;
$function$;
