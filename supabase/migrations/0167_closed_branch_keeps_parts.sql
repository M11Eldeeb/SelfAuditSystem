-- A closed branch can still keep its parts (Qassim): no self audit cycle for it, but its claims stay on the
-- Do not scrap / flagged-to-scrap / Already scrapped lists like an open branch. keeps_parts = true marks it.
-- Abha and Jeddah Nakheel stay as before (closed: everything counts as already scrapped).
alter table public.self_audit_branches add column if not exists keeps_parts boolean not null default false;
update public.self_audit_branches set keeps_parts = true where code = 'QSM';

-- Undo 0109 for Qassim: the requests it created as "scrapped" (no cycle, no evidence) go away, so the claims come
-- back on the Do not scrap list; the flagged ones it closed as "scrapped" (no evidence) are pending again.
delete from public.self_audit_scrap_requests sr
using public.self_audit_branches b
where b.id = sr.branch_id and b.keeps_parts and sr.status = 'scrapped' and sr.cycle_id is null
  and not exists (select 1 from public.self_audit_scrap_request_videos v where v.scrap_request_id = sr.id);

update public.self_audit_scrap_requests sr
set status = 'pending', submitted_at = null
from public.self_audit_branches b
where b.id = sr.branch_id and b.keeps_parts and sr.status = 'scrapped' and sr.cycle_id is not null
  and sr.submitted_at::date = date '2026-10-14'
  and not exists (select 1 from public.self_audit_scrap_request_videos v where v.scrap_request_id = sr.id);

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
  where b.id = sr.branch_id and b.active = false and not b.keeps_parts and sr.status = 'pending';
  get diagnostics v_converted = row_count;

  with eligible as (
    select s.claim_id as id, s.branch_id, s.work_order_no, s.labor_code, s.verification_date
    from self_audit_claim_settlement s
    join self_audit_branches b on b.id = s.branch_id and b.active = false and not b.keeps_parts
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

create or replace function public.refresh_do_not_scrap_cache()
returns integer
language plpgsql
as $function$
declare
  v_count integer;
begin
  if not cache_needs_refresh('do_not_scrap', array[
    'self_audit_claims', 'self_audit_claim_parts', 'self_audit_branches', 'self_audit_scrap_requests',
    'self_audit_scrapped_parts', 'self_audit_supplier_collection_parts', 'self_audit_supplier_collections']) then
    return -1;
  end if;

  delete from self_audit_do_not_scrap_cache;

  insert into self_audit_do_not_scrap_cache
    (branch_id, claim_number, work_order_no, vin, vehicle_series, part_no, part_name, quantity, creation_date, repair_end_date, first_submit_date, holding_period_days)
  select
    c.branch_id, c.claim_number, c.work_order_no, c.vin, c.raw_row->>'Vehicle Series', cp.part_no,
    coalesce(cp.part_name, c.main_part_name), cp.quantity, c.creation_date, c.repair_end_date, c.raw_row->>'First Submit Date',
    case when c.verification_date is not null then current_date - c.verification_date else null end
  from self_audit_claims c
  join self_audit_branches br on br.id = c.branch_id and (br.active = true or br.keeps_parts)
  left join claim_part_lines() cp on cp.claim_id = c.id
  where c.has_parts = true
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
    and not exists (
      select 1 from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      where scp.claim_id = c.id
        and (sc.status = 'handed_over' or (sc.status = 'pending' and (sc.collection_date is null or sc.collection_date >= current_date)))
    )
    and c.raw_row->>'Status' is distinct from 'Closed'
    and coalesce(c.raw_row->>'Status', '') not ilike '%reject%'
    and c.raw_row->>'Status' is distinct from 'Draft saved'
    and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- The flagged-to-scrap generation: same as before, but a branch that keeps its parts is included.
do $do$
declare
  v_def text := pg_get_functiondef('public.run_generate_scrap_requests_all()'::regprocedure);
begin
  if position('br.active = true or br.keeps_parts' in v_def) = 0 then
    v_def := replace(v_def, 'join self_audit_branches br on br.id = s.branch_id and br.active = true',
                            'join self_audit_branches br on br.id = s.branch_id and (br.active = true or br.keeps_parts)');
    if position('br.keeps_parts' in v_def) = 0 then
      raise exception 'run_generate_scrap_requests_all: branch join not found';
    end if;
    execute v_def;
  end if;
end;
$do$;

select public.refresh_do_not_scrap_cache();
