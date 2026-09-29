-- generate_scrap_requests() genuinely failed in production: "canceling
-- statement due to statement timeout" - the `authenticated` role (every
-- real request, confirmed via pg_roles.rolconfig) has statement_timeout=8s,
-- not the 2min shown under this migration tool's own superuser connection
-- (that number never applied to real traffic - a testing gap, not a guess).
--
-- Real cause, measured via EXPLAIN ANALYZE against live data: the claim
-- candidate scan takes ~12-20s regardless of predicate shape - even a scan
-- touching zero JSONB (no raw_row access at all) took the same ~12s, so
-- this isn't a missing-index problem, it's this project's free-tier disk
-- throughput itself (same root cause as the earlier upload-speed incident).
-- 47,000+ of ~61,000 claims are has_parts + verification_date 90+ days old
-- - genuinely not a selective predicate on this dataset, so no index
-- rewrite fixes the scan cost; only the two anti-joins narrow it down, and
-- Postgres has to walk the base table either way.
--
-- Fix: SET LOCAL statement_timeout inside the function, scoped to just this
-- call (PostgREST wraps each RPC in its own transaction) - doesn't touch
-- the platform-wide 8s default that protects every other query.
create or replace function public.generate_scrap_requests()
returns integer
language plpgsql
as $$
declare
  v_created integer;
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  set local statement_timeout = '45s';

  create temporary table tmp_scrap_candidates on commit drop as
  select
    c.id as claim_id,
    c.branch_id,
    c.work_order_no,
    c.labor_code as main_labor_code,
    c.verification_date as settlement_date,
    (current_date - c.verification_date) as holding_period_days,
    coalesce(
      (select jsonb_agg(jsonb_build_object('part_no', cp.part_no, 'part_name', cp.part_name, 'quantity', cp.quantity))
       from self_audit_claim_parts cp where cp.claim_id = c.id),
      case when c.main_part_name is not null or (c.raw_row->>'Main Part') is not null
        then jsonb_build_array(jsonb_build_object(
          'part_no', coalesce(c.raw_row->>'Main Part', c.raw_row->>'Part Number', c.raw_row->>'Part No', c.raw_row->>'Part Code'),
          'part_name', c.main_part_name,
          'quantity', null
        ))
        else '[]'::jsonb
      end
    ) as candidate_parts
  from self_audit_claims c
  where c.has_parts = true
    and c.verification_date is not null
    and c.verification_date <= (current_date - 90)
    and lower(c.raw_row->>'Status') in ('approved', 'settled', 'to be settled')
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id);

  create temporary table tmp_scrap_requests on commit drop as
  select
    t.claim_id, t.branch_id, t.work_order_no, t.main_labor_code, t.settlement_date, t.holding_period_days,
    (
      select jsonb_agg(part) from jsonb_array_elements(t.candidate_parts) part
      where not exists (
        select 1 from self_audit_supplier_collection_parts scp
        where scp.claim_id = t.claim_id and scp.part_no = part->>'part_no'
      )
    ) as remaining_parts
  from tmp_scrap_candidates t;

  with ins as (
    insert into self_audit_scrap_requests (claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, status)
    select claim_id, branch_id, work_order_no, main_labor_code, settlement_date, holding_period_days, 'pending'
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

  select count(*) into v_created from tmp_scrap_requests
  where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0;

  drop table tmp_scrap_candidates;
  drop table tmp_scrap_requests;
  return v_created;
end;
$$;
