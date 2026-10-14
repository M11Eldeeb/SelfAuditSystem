-- Claims that have no rows in self_audit_claim_parts (they arrived after the last "Part Details" upload, or the
-- file had no such sheet) showed up blank in the "Do not scrap" report - no part number, no part name - even though
-- the claim row itself carries its part number(s) in the "Part No" column ("#10726189", several as "#1;2") and the same
-- part numbers are on other claims together with their names.
--
-- claim_part_lines() gives every claim's parts: the detailed rows where they exist, otherwise the numbers from the claim's
-- own "Part No" / "Part Quantity" columns, with the name looked up from any other claim that has the same part number.
-- The do-not-scrap cache and the scrap list generation both read through it, so neither misses these parts.

create or replace function public.claim_part_lines(p_claim_ids uuid[] default null)
returns table (claim_id uuid, part_no text, part_name text, quantity numeric)
language sql stable
as $$
  select cp.claim_id, cp.part_no, cp.part_name, cp.quantity
  from self_audit_claim_parts cp
  where p_claim_ids is null or cp.claim_id = any(p_claim_ids)
  union all
  select c.id,
         nullif(btrim(pn.part_no), ''),
         coalesce(n.part_name, c.main_part_name),
         nullif(substring(coalesce((string_to_array(regexp_replace(coalesce(c.raw_row->>'Part Quantity', ''), '^#', ''), ';'))[pn.i], '') from '[0-9]+\.?[0-9]*'), '')::numeric
  from self_audit_claims c
  cross join lateral unnest(string_to_array(regexp_replace(c.raw_row->>'Part No', '^#', ''), ';')) with ordinality as pn(part_no, i)
  left join (
    select distinct on (part_no) part_no, part_name from self_audit_claim_parts where part_name is not null order by part_no
  ) n on n.part_no = btrim(pn.part_no)
  where c.has_parts
    and c.raw_row->>'Part No' is not null
    and (p_claim_ids is null or c.id = any(p_claim_ids))
    and not exists (select 1 from self_audit_claim_parts x where x.claim_id = c.id);
$$;

create or replace function public.refresh_do_not_scrap_cache()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  truncate table self_audit_do_not_scrap_cache;

  insert into self_audit_do_not_scrap_cache
    (branch_id, claim_number, work_order_no, vin, vehicle_series, part_no, part_name, quantity, creation_date, repair_end_date, first_submit_date, holding_period_days)
  select
    c.branch_id,
    c.claim_number,
    c.work_order_no,
    c.vin,
    c.raw_row->>'Vehicle Series',
    cp.part_no,
    coalesce(cp.part_name, c.main_part_name),
    cp.quantity,
    c.creation_date,
    c.repair_end_date,
    c.raw_row->>'First Submit Date',
    case when c.verification_date is not null then current_date - c.verification_date else null end
  from self_audit_claims c
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
    and c.raw_row->>'Status' is distinct from 'Rejected'
    and c.raw_row->>'Status' is distinct from 'Draft saved'
    and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
  v_cycle_id uuid;
begin
  select id into v_cycle_id from self_audit_warranty_room_cycles order by cycle_month desc limit 1;

  loop
    create temporary table tmp_claims_page on commit drop as
    select c.id, c.branch_id, c.work_order_no, c.labor_code, c.verification_date, c.main_part_name, c.raw_row, c.has_parts
    from self_audit_claims c
    where v_after_id is null or c.id > v_after_id
    order by c.id
    limit v_page_size;

    select count(*) into v_scanned from tmp_claims_page;
    select id into v_next_after_id from tmp_claims_page order by id desc limit 1;

    -- This page's parts (detailed rows, or the claim's own part number when it has none).
    create temporary table tmp_page_parts on commit drop as
    select * from claim_part_lines((select array_agg(id) from tmp_claims_page));

    create temporary table tmp_scrap_candidates on commit drop as
    select
      c.id as claim_id,
      c.branch_id,
      c.work_order_no,
      c.labor_code as main_labor_code,
      c.verification_date as settlement_date,
      (current_date - c.verification_date) as holding_period_days,
      coalesce(
        (select jsonb_agg(jsonb_build_object('part_no', pp.part_no, 'part_name', pp.part_name, 'quantity', pp.quantity))
         from tmp_page_parts pp where pp.claim_id = c.id),
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
      and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
      and not exists (
        select 1 from self_audit_supplier_collection_parts scp
        join self_audit_supplier_collections sc on sc.id = scp.collection_id
        where scp.claim_id = c.id and sc.status = 'handed_over'
      );

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

    select count(*) into v_page_created from tmp_scrap_requests
    where remaining_parts is not null and jsonb_array_length(remaining_parts) > 0;
    v_total_created := v_total_created + v_page_created;

    drop table tmp_claims_page;
    drop table tmp_page_parts;
    drop table tmp_scrap_candidates;
    drop table tmp_scrap_requests;

    exit when v_scanned < v_page_size or v_next_after_id is null;
    v_after_id := v_next_after_id;
  end loop;

  return v_total_created;
end;
$$;
