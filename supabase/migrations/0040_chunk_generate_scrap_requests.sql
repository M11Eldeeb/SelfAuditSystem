-- SET LOCAL statement_timeout inside generate_scrap_requests() (migration
-- 0039) did NOT fix the real production failure - verified directly:
-- Postgres arms statement_timeout when the outer statement begins (the RPC
-- call itself), and a SET LOCAL executed mid-function does not rearm it for
-- the remainder of that same already-in-flight statement. Confirmed live:
-- capped a session at 5s, called the function (internal SET LOCAL to 45s),
-- it was still killed at the 5s mark.
--
-- Real fix: chunk the classification scan itself, the same way every other
-- large Warranty Room operation in this app already is (300-row upload
-- chunks, etc.) - scan self_audit_claims in id-ordered pages small enough
-- to finish well under the `authenticated` role's real 8s statement_timeout
-- (measured: ~12s to scan the whole ~61,000-row table, so a 20,000-row page
-- is a safe ~4s with real margin), and let the client loop through pages.
create or replace function public.generate_scrap_requests_chunk(p_after_id uuid, p_limit integer)
returns table (created integer, scanned integer, next_after_id uuid)
language plpgsql
as $$
declare
  v_created integer;
  v_scanned integer;
  v_next_after_id uuid;
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  create temporary table tmp_claims_page on commit drop as
  select c.id, c.branch_id, c.work_order_no, c.labor_code, c.verification_date, c.main_part_name, c.raw_row, c.has_parts
  from self_audit_claims c
  where p_after_id is null or c.id > p_after_id
  order by c.id
  limit p_limit;

  select count(*) into v_scanned from tmp_claims_page;
  select id into v_next_after_id from tmp_claims_page order by id desc limit 1;

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
  from tmp_claims_page c
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

  drop table tmp_claims_page;
  drop table tmp_scrap_candidates;
  drop table tmp_scrap_requests;

  return query select v_created, v_scanned, v_next_after_id;
end;
$$;

drop function if exists public.generate_scrap_requests();
