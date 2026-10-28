-- Claims & Financials month charts (at least 5 months, whatever range is picked): the narrow claim table also keeps the
-- branch, repair end date, adjusted total and the labor / parts / sublet split before adjustment, so the months can be
-- summed without reading raw_row.
alter table public.self_audit_claim_settlement
  add column if not exists branch_id uuid,
  add column if not exists repair_end date,
  add column if not exists adjusted numeric(14, 2),
  add column if not exists labor_before numeric(14, 2),
  add column if not exists part_before numeric(14, 2),
  add column if not exists sublet_before numeric(14, 2);
create index if not exists self_audit_claim_settlement_repair_idx on public.self_audit_claim_settlement (repair_end);
create index if not exists self_audit_claim_settlement_submit_idx on public.self_audit_claim_settlement (first_submit);

create or replace function public.sync_claim_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into self_audit_claim_settlement (claim_id, payment_order, settlement_order, settle_vat, first_submit, settlement_date, status, claim_amount,
                                           branch_id, repair_end, adjusted, labor_before, part_before, sublet_before)
  values (
    new.id,
    nullif(btrim(new.raw_row->>'Payment Order'), ''),
    nullif(btrim(new.raw_row->>'Settlement Order'), ''),
    safe_numeric(new.raw_row->>'Settle TOL.(VAT)'),
    safe_date(new.raw_row->>'First Submit Date'),
    safe_date(new.raw_row->>'Settlement Date'),
    nullif(btrim(new.raw_row->>'Status'), ''),
    new.claim_amount,
    new.branch_id,
    new.repair_end_date,
    safe_numeric(new.raw_row->>'Adjusted Claim TOL.'),
    safe_numeric(new.raw_row->>'Labor TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Part TOL. Before Adjustment'),
    safe_numeric(new.raw_row->>'Sublet TOL.Before Adjustment')
  )
  on conflict (claim_id) do update set
    payment_order = excluded.payment_order,
    settlement_order = excluded.settlement_order,
    settle_vat = excluded.settle_vat,
    first_submit = excluded.first_submit,
    settlement_date = excluded.settlement_date,
    status = excluded.status,
    claim_amount = excluded.claim_amount,
    branch_id = excluded.branch_id,
    repair_end = excluded.repair_end,
    adjusted = excluded.adjusted,
    labor_before = excluded.labor_before,
    part_before = excluded.part_before,
    sublet_before = excluded.sublet_before;
  return null;
end;
$$;

-- Fill the new columns for the claims already uploaded (once).
update self_audit_claim_settlement s set
  branch_id = c.branch_id,
  repair_end = c.repair_end_date,
  adjusted = safe_numeric(c.raw_row->>'Adjusted Claim TOL.'),
  labor_before = safe_numeric(c.raw_row->>'Labor TOL. Before Adjustment'),
  part_before = safe_numeric(c.raw_row->>'Part TOL. Before Adjustment'),
  sublet_before = safe_numeric(c.raw_row->>'Sublet TOL.Before Adjustment')
from self_audit_claims c
where c.id = s.claim_id;

/** Per month: claimed vs adjusted by repair end date, and the submitted claims (first submit date) split labor / parts / sublet. */
create or replace function public.claims_month_series(p_branches uuid[], p_from date, p_to date)
returns table (kind text, month text, claims bigint, claimed numeric, adjusted numeric, labor numeric, parts numeric, sublet numeric)
language sql stable security definer set search_path = public
as $$
  select 'repair', to_char(repair_end, 'YYYY-MM'), count(*), round(sum(coalesce(claim_amount, 0)), 2), round(sum(coalesce(adjusted, claim_amount, 0)), 2), null::numeric, null::numeric, null::numeric
  from self_audit_claim_settlement
  where repair_end >= p_from and repair_end < p_to and branch_id = any (p_branches)
  group by 2
  union all
  select 'submit', to_char(first_submit, 'YYYY-MM'), count(*), round(sum(coalesce(claim_amount, 0)), 2), null, round(sum(coalesce(labor_before, 0)), 2), round(sum(coalesce(part_before, 0)), 2), round(sum(coalesce(sublet_before, 0)), 2)
  from self_audit_claim_settlement
  where first_submit >= p_from and first_submit < p_to and branch_id = any (p_branches)
    and coalesce(status, '') not in ('Draft saved', 'Rejected', 'Rejected from chief agent')
  group by 2;
$$;
revoke all on function public.claims_month_series(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.claims_month_series(uuid[], date, date) to service_role;
