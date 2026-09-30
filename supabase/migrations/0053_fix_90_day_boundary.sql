-- Boundary bug: `verification_date <= current_date - 90` flags a claim at
-- EXACTLY 90 days held, not just past it. Officer confirmed: 90 days = not
-- yet scrap-eligible, 91 days = scrap-eligible. Fixes the predicate to `<`
-- and removes the 84 scrap requests (52 pending, 32 presumed_scrapped)
-- already wrongly created at exactly holding_period_days = 90 - cascades to
-- their parts/videos/events. Refreshes both report caches (0051, 0052) so
-- Scrapping List and Do Not Scrap reflect the correction immediately
-- instead of waiting for the next 15-minute cron tick.
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

delete from self_audit_scrap_requests where holding_period_days = 90;

select public.refresh_already_scrapped_cache();
select public.refresh_do_not_scrap_cache();
