-- Collapses insertScrappedPartsChunk's ~5 sequential round trips per chunk
-- (claim lookup, two existing-key lookups, up to 3 upsert/insert statements)
-- into one round trip. Root-caused via EXPLAIN ANALYZE: a 300-row upsert
-- into self_audit_claims (the OTHER slow sheet, already a single round trip)
-- only takes ~0.6s of real DB execution time on this project's free-tier
-- compute, so raw query cost was never the bottleneck for either sheet - the
-- fixed per-HTTP-request overhead (Vercel function invocation + a fresh
-- auth.getUser() network round trip to GoTrue on every single chunk, per
-- src/lib/auth.ts's getCurrentUser) dominates for hundreds of small chunk
-- requests. Paired with the client-side change (both upload forms now call
-- Supabase directly from the browser instead of proxying through a Vercel
-- API route) that removes that per-request overhead entirely and lets chunk
-- size grow well past Vercel's 4.5MB request-body cap, which no longer
-- applies once Supabase is called directly.
--
-- No SECURITY DEFINER here - officers already have full SELECT/INSERT/UPDATE
-- via the existing "officers manage claims" / "officers manage
-- scrapped_parts" RLS policies, so this runs as the caller with RLS fully
-- enforced exactly as today, just in one statement instead of several.
create or replace function public.upsert_scrapped_parts_chunk(p_batch_id uuid, p_rows jsonb)
returns table (unmatched integer, merged integer, added integer)
language plpgsql
as $$
declare
  v_unmatched integer := 0;
  v_added integer := 0;
  v_merged integer := 0;
  v_ins integer;
  v_upd integer;
begin
  create temporary table tmp_scrap_rows on commit drop as
  select
    x.claim_number,
    nullif(x.branch_id, '')::uuid as branch_id,
    nullif(x.external_request_no, '') as external_request_no,
    nullif(x.work_order_no, '') as work_order_no,
    nullif(x.vin, '') as vin,
    nullif(x.part_no, '') as part_no,
    nullif(x.part_name, '') as part_name,
    x.quantity,
    nullif(x.main_labor_code, '') as main_labor_code,
    nullif(x.main_labor_name, '') as main_labor_name,
    nullif(x.settlement_date, '')::date as settlement_date,
    x.holding_period_days,
    c.id as claim_id
  from jsonb_to_recordset(p_rows) as x (
    claim_number text, branch_id text, external_request_no text, work_order_no text,
    vin text, part_no text, part_name text, quantity int,
    main_labor_code text, main_labor_name text, settlement_date text, holding_period_days int
  )
  left join lateral (
    select cl.id
    from self_audit_claims cl
    where cl.claim_number = x.claim_number
    order by (cl.branch_id::text = x.branch_id) desc nulls last
    limit 1
  ) c on true;

  select count(*) filter (where claim_id is null) into v_unmatched from tmp_scrap_rows;

  -- matched: has a resolved claim and a part number - upsert on (claim_id, part_no)
  with ins as (
    insert into self_audit_scrapped_parts (
      claim_id, external_request_no, work_order_no, vin, part_no, part_name,
      quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, upload_batch_id
    )
    select claim_id, external_request_no, work_order_no, vin, part_no, part_name,
           quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, p_batch_id
    from tmp_scrap_rows
    where claim_id is not null and part_no is not null
    on conflict (claim_id, part_no) do update set
      external_request_no = excluded.external_request_no,
      work_order_no = excluded.work_order_no,
      vin = excluded.vin,
      part_name = excluded.part_name,
      quantity = excluded.quantity,
      main_labor_code = excluded.main_labor_code,
      main_labor_name = excluded.main_labor_name,
      settlement_date = excluded.settlement_date,
      holding_period_days = excluded.holding_period_days,
      upload_batch_id = excluded.upload_batch_id
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert), count(*) filter (where not was_insert)
  into v_ins, v_upd from ins;
  v_added := v_added + coalesce(v_ins, 0);
  v_merged := v_merged + coalesce(v_upd, 0);

  -- no resolved claim, but a work order + part number identify the record instead
  with ins as (
    insert into self_audit_scrapped_parts (
      claim_id, external_request_no, work_order_no, vin, part_no, part_name,
      quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, upload_batch_id
    )
    select claim_id, external_request_no, work_order_no, vin, part_no, part_name,
           quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, p_batch_id
    from tmp_scrap_rows
    where claim_id is null and work_order_no is not null and part_no is not null
    on conflict (work_order_no, part_no) do update set
      external_request_no = excluded.external_request_no,
      vin = excluded.vin,
      part_name = excluded.part_name,
      quantity = excluded.quantity,
      main_labor_code = excluded.main_labor_code,
      main_labor_name = excluded.main_labor_name,
      settlement_date = excluded.settlement_date,
      holding_period_days = excluded.holding_period_days,
      upload_batch_id = excluded.upload_batch_id
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert), count(*) filter (where not was_insert)
  into v_ins, v_upd from ins;
  v_added := v_added + coalesce(v_ins, 0);
  v_merged := v_merged + coalesce(v_upd, 0);

  -- neither identifiable by claim nor by work order - always a plain insert, no merge possible
  insert into self_audit_scrapped_parts (
    claim_id, external_request_no, work_order_no, vin, part_no, part_name,
    quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, upload_batch_id
  )
  select claim_id, external_request_no, work_order_no, vin, part_no, part_name,
         quantity, main_labor_code, main_labor_name, settlement_date, holding_period_days, p_batch_id
  from tmp_scrap_rows
  where not (claim_id is not null and part_no is not null)
    and not (claim_id is null and work_order_no is not null and part_no is not null);
  get diagnostics v_ins = row_count;
  v_added := v_added + v_ins;

  drop table tmp_scrap_rows;
  return query select v_unmatched, v_merged, v_added;
end;
$$;

-- Same collapse (2 round trips -> 1) for the Part Details sheet uploaded
-- alongside the same claims file, via the same "prefer a match in the row's
-- own guessed branch, else any claim with that number" rule the old JS
-- version (upsertClaimPartsChunk) used.
create or replace function public.upsert_claim_parts_chunk(p_batch_id uuid, p_rows jsonb)
returns integer
language plpgsql
as $$
declare
  v_unmatched integer;
begin
  create temporary table tmp_claim_part_rows on commit drop as
  select
    x.claim_number,
    nullif(x.part_no, '') as part_no,
    nullif(x.part_name, '') as part_name,
    x.quantity,
    c.id as claim_id,
    c.branch_id as claim_branch_id
  from jsonb_to_recordset(p_rows) as x (
    claim_number text, branch_id text, part_no text, part_name text, quantity int
  )
  left join lateral (
    select cl.id, cl.branch_id
    from self_audit_claims cl
    where cl.claim_number = x.claim_number
    order by (cl.branch_id::text = x.branch_id) desc nulls last
    limit 1
  ) c on true;

  select count(*) filter (where claim_id is null or part_no is null) into v_unmatched from tmp_claim_part_rows;

  insert into self_audit_claim_parts (claim_id, branch_id, part_no, part_name, quantity, upload_batch_id)
  select claim_id, claim_branch_id, part_no, part_name, quantity, p_batch_id
  from tmp_claim_part_rows
  where claim_id is not null and part_no is not null
  on conflict (claim_id, part_no) do update set
    part_name = excluded.part_name,
    quantity = excluded.quantity,
    upload_batch_id = excluded.upload_batch_id;

  drop table tmp_claim_part_rows;
  return v_unmatched;
end;
$$;
