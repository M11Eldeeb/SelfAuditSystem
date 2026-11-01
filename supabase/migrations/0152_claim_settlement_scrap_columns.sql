-- The scrap list job still read the whole claims table (~200 MB, raw_row inline) to find eligible claims and timed out
-- on the slow disk. The few columns it filters on now live in the narrow self_audit_claim_settlement table too (kept by
-- the same trigger), so finding candidates reads ~25 MB; the claims table is touched only for the candidates.
set local statement_timeout = '15min';

alter table self_audit_claim_settlement
  add column if not exists has_parts boolean,
  add column if not exists verification_date date,
  add column if not exists labor_code text,
  add column if not exists work_order_no text,
  add column if not exists main_part_name text;

create or replace function public.sync_claim_settlement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into self_audit_claim_settlement (claim_id, payment_order, settlement_order, settle_vat, first_submit, settlement_date, status, claim_amount,
                                           branch_id, repair_end, adjusted, labor_before, part_before, sublet_before,
                                           has_parts, verification_date, labor_code, work_order_no, main_part_name)
  values (
    new.id,
    nullif(btrim(new.raw_row->>'Payment Order'), ''),
    nullif(btrim(new.raw_row->>'Settlement Order'), ''),
    safe_numeric(new.raw_row->>'Settle TOL.(VAT)'),
    safe_date(new.raw_row->>'First Submit Date'),
    safe_date(new.raw_row->>'Settlement Date'),
    nullif(btrim(new.raw_row->>'Status'), ''),
    new.claim_amount,
    new.branch_id,
    new.repair_end_date,
    safe_numeric(new.raw_row->>'Adjusted Claim TOL.'),
    safe_numeric(new.raw_row->>'Labor TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Part TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Sublet TOL.Before Adjustment'),
    new.has_parts,
    new.verification_date,
    new.labor_code,
    new.work_order_no,
    new.main_part_name
  )
  on conflict (claim_id) do update set
    payment_order = excluded.payment_order,
    settlement_order = excluded.settlement_order,
    settle_vat = excluded.settle_vat,
    first_submit = excluded.first_submit,
    settlement_date = excluded.settlement_date,
    status = excluded.status,
    claim_amount = excluded.claim_amount,
    branch_id = excluded.branch_id,
    repair_end = excluded.repair_end,
    adjusted = excluded.adjusted,
    labor_before = excluded.labor_before,
    part_before = excluded.part_before,
    sublet_before = excluded.sublet_before,
    has_parts = excluded.has_parts,
    verification_date = excluded.verification_date,
    labor_code = excluded.labor_code,
    work_order_no = excluded.work_order_no,
    main_part_name = excluded.main_part_name;
  return null;
end;
$function$;

-- One pass over the claims (no raw_row read).
update self_audit_claim_settlement s
set has_parts = c.has_parts, verification_date = c.verification_date, labor_code = c.labor_code, work_order_no = c.work_order_no, main_part_name = c.main_part_name
from self_audit_claims c
where c.id = s.claim_id;

create or replace function public.run_generate_scrap_requests_all()
 returns integer
 language plpgsql
as $function$
declare
  v_total_created integer := 0;
  v_cycle_id uuid;
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
    join claim_part_lines((select array_agg(claim_id) from ins)) p on p.claim_id = ins.claim_id
    where p.part_no is not null
    returning 1
  )
  select count(*) into v_added from ins;

  return v_converted + v_added;
end;
$function$;
