-- Scrap requests weren't tied to a specific warranty room cycle at all -
-- approving one cycle's destroy evidence moved EVERY currently-pending part
-- for that branch to scrapped, across all cycles, and "waiting for
-- submission" was inferred from a timestamp comparison rather than a real
-- link. Officer wants real separation: reject an old cycle's evidence while
-- approving a new cycle's independently, and a new cycle's newly-flagged
-- parts never merge into an older cycle's set.
alter table self_audit_scrap_requests add column cycle_id uuid references self_audit_warranty_room_cycles(id);

-- Backfill: only one cycle exists right now (September) - every existing
-- scrap request, flagged before this link existed, belongs to it.
update self_audit_scrap_requests
set cycle_id = 'ab3888c2-ad3a-402b-8332-2c9b579db8cf'
where cycle_id is null;

alter table self_audit_already_scrapped_cache add column cycle_id uuid;

-- Stamps every newly-created pending row with whichever warranty room
-- cycle is currently newest, so it's grouped with "this cycle's" flagged
-- parts, not silently merged with an older cycle's. If no cycle exists yet,
-- new rows get cycle_id = null (nothing to submit against until the
-- officer generates one) rather than the whole scan failing.
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
    drop table tmp_scrap_candidates;
    drop table tmp_scrap_requests;

    exit when v_scanned < v_page_size or v_next_after_id is null;
    v_after_id := v_next_after_id;
  end loop;

  return v_total_created;
end;
$$;

-- Approving one cycle's destroy evidence now only moves THAT cycle's
-- flagged parts to scrapped - an older, still-pending cycle stays
-- untouched (reject it, or leave it, independently).
create or replace function public.approve_destroy_evidence(p_cycle_id uuid, p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_scrapped_count integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  select status into v_status from self_audit_destroy_evidence where cycle_id = p_cycle_id and branch_id = p_branch_id;
  if v_status is null then
    raise exception 'Destroy evidence not found.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'This submission is not awaiting approval.';
  end if;

  with scrapped as (
    update self_audit_scrap_requests
    set status = 'scrapped', submitted_at = now()
    where branch_id = p_branch_id and cycle_id = p_cycle_id and status = 'pending'
    returning id
  )
  select count(*) into v_scrapped_count from scrapped;

  update self_audit_destroy_evidence
  set status = 'sent', sent_at = now(), sent_by = auth.uid()
  where cycle_id = p_cycle_id and branch_id = p_branch_id;

  return v_scrapped_count;
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
    (branch_id, claim_number, work_order_no, status, part_no, part_name, quantity, holding_period_days, first_submit_date, repair_end_date, submitted_at, flagged_at, cycle_id)
  select
    sr.branch_id, c.claim_number, sr.work_order_no, sr.status, srp.part_no, srp.part_name, srp.quantity,
    sr.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sr.submitted_at, sr.created_at, sr.cycle_id
  from self_audit_scrap_requests sr
  join self_audit_claims c on c.id = sr.claim_id
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id

  union all

  select
    c.branch_id, c.claim_number, sp.work_order_no, 'scrapped_legacy', sp.part_no, sp.part_name, sp.quantity::integer,
    sp.holding_period_days, c.raw_row->>'First Submit Date', c.repair_end_date, sp.created_at, null, null
  from self_audit_scrapped_parts sp
  join self_audit_claims c on c.id = sp.claim_id

  union all

  select
    sc.branch_id, coalesce(c.claim_number, scp.work_order_no, 'Unmatched'), scp.work_order_no, 'supplier_collected',
    scp.part_no, scp.part_name, scp.quantity, null::integer, c.raw_row->>'First Submit Date', c.repair_end_date, sc.handed_over_at, null, null
  from self_audit_supplier_collection_parts scp
  join self_audit_supplier_collections sc on sc.id = scp.collection_id
  left join self_audit_claims c on c.id = scp.claim_id
  where sc.status = 'handed_over';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- waiting_for_submission is now a real link comparison (cycle_id != the
-- current newest cycle), not a timestamp guess.
create or replace function public.get_flagged_to_scrap_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current_cycle_id uuid;
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  select id into v_current_cycle_id from self_audit_warranty_room_cycles order by cycle_month desc limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'holding_period_days', x.holding_period_days,
      'first_submit_date', x.first_submit_date,
      'repair_end_date', x.repair_end_date,
      'waiting_for_submission', x.cycle_id is distinct from v_current_cycle_id
    ) order by x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    where x.branch_id = p_branch_id
      and x.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
