-- get_already_scrapped_claims measured at 8.9s for Jeddah Heraa (EXPLAIN
-- ANALYZE, real data) - just over the `authenticated` role's 8s
-- statement_timeout (see migrations 0039-0041 for the full investigation
-- that first found this constraint). SECURITY DEFINER doesn't change it:
-- statement_timeout is a session-level GUC tied to the connecting role, not
-- the function owner, confirmed empirically earlier this session. Same
-- fix as before - move the expensive scan off the interactive request path
-- entirely, onto a pg_cron-refreshed cache table (runs as postgres, no
-- statement_timeout). The report is now up to ~15 minutes stale, the same
-- tradeoff already accepted for the pending-scrap-request cron.
create table self_audit_already_scrapped_cache (
  id bigint generated always as identity primary key,
  branch_id uuid not null references self_audit_branches(id),
  claim_number text not null,
  work_order_no text,
  status text not null,
  part_no text,
  part_name text,
  quantity integer,
  holding_period_days integer,
  first_submit_date text,
  repair_end_date date,
  submitted_at timestamptz
);
create index self_audit_already_scrapped_cache_branch_id_idx on self_audit_already_scrapped_cache (branch_id);

alter table self_audit_already_scrapped_cache enable row level security;

create policy "branch admins read own already_scrapped_cache"
  on self_audit_already_scrapped_cache for select
  using (branch_id = current_user_branch_id());

create policy "officers read already_scrapped_cache"
  on self_audit_already_scrapped_cache for select
  using (current_user_role() = 'officer');

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

select cron.schedule('refresh-already-scrapped-cache', '*/15 * * * *', 'select public.refresh_already_scrapped_cache();');

create or replace function public.get_already_scrapped_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', x.claim_number,
      'work_order_no', x.work_order_no,
      'status', x.status,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'holding_period_days', x.holding_period_days,
      'first_submit_date', x.first_submit_date,
      'repair_end_date', x.repair_end_date,
      'submitted_at', x.submitted_at
    ) order by x.submitted_at desc nulls last, x.claim_number, x.part_no nulls last)
    from self_audit_already_scrapped_cache x
    where x.branch_id = p_branch_id
  ), '[]'::jsonb);
end;
$$;
