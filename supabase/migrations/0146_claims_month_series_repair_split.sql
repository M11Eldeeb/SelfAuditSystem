-- claims_month_series: the repair-end rows also carry the labor / parts / sublet split (Reconciliation -> Claims vs invoicing can match by repair end date).
create or replace function public.claims_month_series(p_branches uuid[], p_from date, p_to date)
returns table (kind text, month text, claims bigint, claimed numeric, adjusted numeric, labor numeric, parts numeric, sublet numeric)
language sql stable security definer set search_path = public
as $$
  select 'repair', to_char(repair_end, 'YYYY-MM'), count(*), round(sum(coalesce(claim_amount, 0)), 2), round(sum(coalesce(adjusted, claim_amount, 0)), 2),
         round(sum(coalesce(labor_before, 0)), 2), round(sum(coalesce(part_before, 0)), 2), round(sum(coalesce(sublet_before, 0)), 2)
  from self_audit_claim_settlement
  where repair_end >= p_from and repair_end < p_to and branch_id = any (p_branches)
  group by 2
  union all
  select 'submit', to_char(first_submit, 'YYYY-MM'), count(*), round(sum(coalesce(claim_amount, 0)), 2), null,
         round(sum(coalesce(labor_before, 0)), 2), round(sum(coalesce(part_before, 0)), 2), round(sum(coalesce(sublet_before, 0)), 2)
  from self_audit_claim_settlement
  where first_submit >= p_from and first_submit < p_to and branch_id = any (p_branches)
    and coalesce(status, '') not in ('Draft saved', 'Rejected', 'Rejected from chief agent')
  group by 2;
$$;
