-- The 3rd real "statement timeout" report traced to get_do_not_scrap_claims,
-- not get_already_scrapped_claims (0051) - never actually measured this one
-- under real authenticated-role + RLS conditions until now. Measured
-- (SET LOCAL ROLE authenticated, real JWT claims, not the privileged SQL
-- editor connection): 12.96s for Jeddah Heraa, well past the 8s
-- statement_timeout. Same fix as 0051 - cron-refreshed cache table instead
-- of a live correlated-subquery scan on every request. This also speeds up
-- the officer's existing /admin/warranty-room/do-not-scrap preview page,
-- which calls the same function directly.
create table self_audit_do_not_scrap_cache (
  id bigint generated always as identity primary key,
  branch_id uuid not null references self_audit_branches(id),
  claim_number text not null,
  work_order_no text,
  vin text,
  vehicle_series text,
  part_no text,
  part_name text,
  quantity integer,
  creation_date date not null,
  repair_end_date date,
  first_submit_date text,
  holding_period_days integer
);
create index self_audit_do_not_scrap_cache_branch_id_idx on self_audit_do_not_scrap_cache (branch_id);

alter table self_audit_do_not_scrap_cache enable row level security;

create policy "branch admins read own do_not_scrap_cache"
  on self_audit_do_not_scrap_cache for select
  using (branch_id = current_user_branch_id());

create policy "officers read do_not_scrap_cache"
  on self_audit_do_not_scrap_cache for select
  using (current_user_role() = 'officer');

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
  left join self_audit_claim_parts cp on cp.claim_id = c.id
  where c.has_parts = true
    and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
    and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
    and c.raw_row->>'Status' is distinct from 'Closed'
    and c.raw_row->>'Status' is distinct from 'Rejected'
    and c.raw_row->>'Status' is distinct from 'Draft saved'
    and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select cron.schedule('refresh-do-not-scrap-cache', '*/15 * * * *', 'select public.refresh_do_not_scrap_cache();');

create or replace function public.get_do_not_scrap_claims(p_branch_id uuid)
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
      'vin', x.vin,
      'vehicle_series', x.vehicle_series,
      'part_no', x.part_no,
      'part_name', x.part_name,
      'quantity', x.quantity,
      'creation_date', x.creation_date,
      'repair_end_date', x.repair_end_date,
      'first_submit_date', x.first_submit_date,
      'holding_period_days', x.holding_period_days
    ) order by x.creation_date desc, x.claim_number, x.part_no nulls last)
    from self_audit_do_not_scrap_cache x
    where x.branch_id = p_branch_id
  ), '[]'::jsonb);
end;
$$;
