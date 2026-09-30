-- Correction to 0054: claims crossing 91+ days should show as scrap
-- IMMEDIATELY (continuously, as soon as the cron finds them), not sit
-- hidden in a 'queued' staging state until the next cycle. What the officer
-- actually wants at cycle generation is a HIGHLIGHT, not a visibility gate -
-- the ones that became scrap between the last cycle and this one should
-- stand out, but earlier ones shouldn't disappear in the meantime.
--
-- This already falls out of the existing pending/presumed_scrapped model
-- once the cron goes back to inserting 'pending' directly: whatever's
-- 'pending' at any moment IS "become scrap since the last rollover", since
-- release_scrap_requests_for_new_cycle (called from generateCycle) promotes
-- the PREVIOUS batch to presumed_scrapped at that moment. The Scrapping
-- List already highlights status='pending' rows yellow as
-- "NEW scrap part (this cycle)" - no separate queued stage needed, and no
-- change needed to the highlighting logic itself.
alter table self_audit_scrap_requests drop constraint self_audit_scrap_requests_status_check;
alter table self_audit_scrap_requests add constraint self_audit_scrap_requests_status_check
  check (status = any (array['pending', 'presumed_scrapped', 'scrapped']));

create or replace function public.run_generate_scrap_requests_all()
returns integer
language plpgsql
as $$
declare
  v_after_id uuid := null;
  v_scanned integer;
  v_next_after_id uuid;
  v_page_created integer;
  v_total_created integer := 0;
  v_page_size integer := 5000;
begin
  loop
    create temporary table tmp_claims_page on commit drop as
    select c.id, c.branch_id, c.work_order_no, c.labor_code, c.verification_date, c.main_part_name, c.raw_row, c.has_parts
    from self_audit_claims c
    where v_after_id is null or c.id > v_after_id
    order by c.id
    limit v_page_size;

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
      and c.verification_date < (current_date - 90)
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

    select count(*) into v_page_created from tmp_scrap_requests
    where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0;
    v_total_created := v_total_created + v_page_created;

    drop table tmp_claims_page;
    drop table tmp_scrap_candidates;
    drop table tmp_scrap_requests;

    exit when v_scanned < v_page_size or v_next_after_id is null;
    v_after_id := v_next_after_id;
  end loop;

  return v_total_created;
end;
$$;

-- Just the promotion now - there's no 'queued' stage left to release.
create or replace function public.release_scrap_requests_for_new_cycle()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_promoted integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  with promoted as (
    update self_audit_scrap_requests set status = 'presumed_scrapped' where status = 'pending' returning id
  )
  select count(*) into v_promoted from promoted;

  return jsonb_build_object('promoted', v_promoted);
end;
$$;

create or replace function public.refresh_already_scrapped_cache()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  truncate table self_audit_already_scrapped_cache;

  insert into self_audit_already_scrapped_cache
    (branch_id, claim_number, work_order_no, status, part_no, part_name, quantity, holding_period_days, first_submit_date, repair_end_date, submitted_at)
  select
    sr.branch_id, c.claim_number, sr.work_order_no, sr.status, srp.part_no, srp.part_name, srp.quantity,
    sr.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sr.submitted_at
  from self_audit_scrap_requests sr
  join self_audit_claims c on c.id = sr.claim_id
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id

  union all

  select
    c.branch_id, c.claim_number, sp.work_order_no, 'scrapped_legacy', sp.part_no, sp.part_name, sp.quantity::integer,
    sp.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sp.created_at
  from self_audit_scrapped_parts sp
  join self_audit_claims c on c.id = sp.claim_id

  union all

  select
    sc.branch_id, coalesce(c.claim_number, scp.work_order_no, 'Unmatched'), scp.work_order_no, 'supplier_collected',
    scp.part_no, scp.part_name, scp.quantity, null::integer, c.raw_row->>'First Submit Date', c.repair_end_date, sc.handed_over_at
  from self_audit_supplier_collection_parts scp
  join self_audit_supplier_collections sc on sc.id = scp.collection_id
  left join self_audit_claims c on c.id = scp.claim_id
  where sc.status = 'handed_over';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
