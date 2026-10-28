-- The two scrap caches were rebuilt every 15 minutes, each reading the whole claims table (~200 MB with raw_row) for
-- 70-110 s, both at the same time, and TRUNCATE locked the cache tables for the whole rebuild - so the dashboard and
-- Warranty Room waited behind them or timed out ("The dashboard couldn't load").
--
-- Now:
--  * a rebuild runs only when one of its source tables changed (insert / update / delete counters) or the day changed
--    (holding days and the supplier collection date depend on today); otherwise it returns at once;
--  * DELETE instead of TRUNCATE, so readers keep seeing the previous rows until the new ones are committed;
--  * the two jobs no longer start at the same minute.

create table if not exists self_audit_cache_fingerprints (
  cache_name text primary key,
  fingerprint text not null,
  refreshed_at timestamptz not null default now()
);
alter table self_audit_cache_fingerprints enable row level security;

-- Today + the write counters of the given tables: changes whenever any of them is written (or the date rolls over).
create or replace function cache_source_fingerprint(p_tables text[])
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select (now() at time zone 'Asia/Riyadh')::date::text || ':' ||
         coalesce(string_agg(relname || '=' || (n_tup_ins + n_tup_upd + n_tup_del)::text, ',' order by relname), '')
  from pg_stat_user_tables
  where schemaname = 'public' and relname = any(p_tables);
$$;

-- True (and records the new fingerprint) when the cache needs a rebuild.
create or replace function cache_needs_refresh(p_cache text, p_tables text[])
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now text := cache_source_fingerprint(p_tables);
  v_old text;
begin
  select fingerprint into v_old from self_audit_cache_fingerprints where cache_name = p_cache;
  if v_old is not distinct from v_now then
    return false;
  end if;
  insert into self_audit_cache_fingerprints (cache_name, fingerprint, refreshed_at) values (p_cache, v_now, now())
  on conflict (cache_name) do update set fingerprint = excluded.fingerprint, refreshed_at = excluded.refreshed_at;
  return true;
end;
$$;

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
  join self_audit_branches br on br.id = c.branch_id and br.active = true
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

create or replace function public.refresh_already_scrapped_cache()
 returns integer
 language plpgsql
as $function$
declare
  v_count integer;
begin
  if not cache_needs_refresh('already_scrapped', array[
    'self_audit_claims', 'self_audit_scrap_requests', 'self_audit_scrap_request_parts', 'self_audit_scrapped_parts',
    'self_audit_supplier_collection_parts', 'self_audit_supplier_collections']) then
    return -1;
  end if;

  delete from self_audit_already_scrapped_cache;

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
$function$;

-- Not at the same minute as the do-not-scrap rebuild.
select cron.alter_job((select jobid from cron.job where jobname = 'refresh-already-scrapped-cache'), schedule := '7,22,37,52 * * * *');
