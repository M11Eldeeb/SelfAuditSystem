-- The parts lookup over every candidate went through claim_part_lines (raw_row for each claim) and timed out: parts now
-- come from self_audit_claim_parts, and claim_part_lines runs only for candidates that have no part rows.
create or replace function public.run_generate_scrap_requests_all()
 returns integer
 language plpgsql
as $function$
declare
  v_total_created integer := 0;
  v_cycle_id uuid;
  v_missing uuid[];
begin
  select id into v_cycle_id from self_audit_warranty_room_cycles order by cycle_month desc limit 1;

  -- Candidates from the narrow table only.
  create temporary table tmp_scrap_candidates_base on commit drop as
  select s.claim_id, s.branch_id, s.work_order_no, s.labor_code as main_labor_code, s.verification_date as settlement_date,
         (current_date - s.verification_date) as holding_period_days, s.main_part_name
  from self_audit_claim_settlement s
  join self_audit_branches br on br.id = s.branch_id and br.active = true
  where s.has_parts = true
    and s.verification_date is not null
    and s.verification_date < (current_date - 90)
    and lower(s.status) in ('approved', 'settled', 'to be settled')
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = s.claim_id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = s.claim_id)
    and not exists (
      select 1 from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      where scp.claim_id = s.claim_id and sc.status = 'handed_over'
    );

  -- Parts from the parts table; the raw-row fallback (claim_part_lines) only for candidates with no part rows.
  create temporary table tmp_page_parts on commit drop as
  select cp.claim_id, cp.part_no, cp.part_name, cp.quantity
  from self_audit_claim_parts cp
  where cp.claim_id in (select claim_id from tmp_scrap_candidates_base);
  select array_agg(b.claim_id) into v_missing from tmp_scrap_candidates_base b
  where not exists (select 1 from self_audit_claim_parts x where x.claim_id = b.claim_id);
  -- (claim_part_lines(null) would mean every claim - so only when some are missing.)
  if v_missing is not null then
    insert into tmp_page_parts select * from claim_part_lines(v_missing);
  end if;

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

-- An empty list must not reach claim_part_lines as null (null = every claim).
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
    select s.claim_id as id, s.branch_id, s.work_order_no, s.labor_code, s.verification_date
    from self_audit_claim_settlement s
    join self_audit_branches b on b.id = s.branch_id and b.active = false
    where s.has_parts = true
      and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = s.claim_id)
      and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = s.claim_id)
      and not exists (
        select 1 from self_audit_supplier_collection_parts scp
        join self_audit_supplier_collections sc on sc.id = scp.collection_id
        where scp.claim_id = s.claim_id
          and (sc.status = 'handed_over' or (sc.status = 'pending' and (sc.collection_date is null or sc.collection_date >= current_date)))
      )
      and s.status is distinct from 'Closed'
      and coalesce(s.status, '') not ilike '%reject%'
      and s.status is distinct from 'Draft saved'
      and not (s.status = 'Returned from chief agent' and s.verification_date is null)
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
    join claim_part_lines(coalesce((select array_agg(claim_id) from ins), '{}'::uuid[])) p on p.claim_id = ins.claim_id
    where p.part_no is not null
    returning 1
  )
  select count(*) into v_added from ins;

  return v_converted + v_added;
end;
$function$;
