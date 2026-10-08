-- Third "deducted by" choice on the Reconciliation tab: GW.
alter table self_audit_reconciliation drop constraint self_audit_reconciliation_deduction_type_check;
alter table self_audit_reconciliation add constraint self_audit_reconciliation_deduction_type_check
  check (deduction_type in ('saic', 'internal', 'gw'));

-- Same summary as 0071 plus the GW amount (return type changes, so drop first).
drop function if exists public.get_reconciliation_summary(uuid[], text);

create function public.get_reconciliation_summary(p_branch_ids uuid[], p_from_order text default 'CRSA6P20261001')
returns table (
  settlement_order text,
  branch_id uuid,
  loss_count bigint,
  loss_amount numeric,
  reviewed_count bigint,
  reviewed_amount numeric,
  reinvoiced_amount numeric,
  overdue_amount numeric,
  saic_amount numeric,
  internal_amount numeric,
  gw_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(current_user_role()::text, '');
  v_branches uuid[];
begin
  if v_role = 'officer' then
    v_branches := p_branch_ids;
  elsif v_role = 'branch_admin' then
    v_branches := array[current_user_branch_id()];
  else
    raise exception 'Not authorized';
  end if;

  return query
  with loss as (
    select c.id, c.branch_id, c.raw_row->>'Settlement Order' as o,
           c.claim_amount - safe_numeric(c.raw_row->>'Adjusted Claim TOL.') as amt
    from self_audit_claims c
    where c.raw_row->>'Status' = 'Settled'
      and c.claim_amount - safe_numeric(c.raw_row->>'Adjusted Claim TOL.') > 0.005
      and c.raw_row->>'Settlement Order' >= p_from_order
      and c.branch_id = any (v_branches)
  )
  select l.o, l.branch_id,
         count(*),
         sum(l.amt),
         count(*) filter (where r.deduction_type is not null or r.outcome is not null),
         coalesce(sum(l.amt) filter (where r.deduction_type is not null or r.outcome is not null), 0),
         coalesce(sum(l.amt) filter (where r.outcome = 'reinvoiced'), 0),
         coalesce(sum(l.amt) filter (where r.outcome = 'overdue'), 0),
         coalesce(sum(l.amt) filter (where r.deduction_type = 'saic'), 0),
         coalesce(sum(l.amt) filter (where r.deduction_type = 'internal'), 0),
         coalesce(sum(l.amt) filter (where r.deduction_type = 'gw'), 0)
  from loss l
  left join self_audit_reconciliation r on r.claim_id = l.id
  group by l.o, l.branch_id
  order by l.o desc;
end;
$$;

revoke all on function public.get_reconciliation_summary(uuid[], text) from public, anon;
grant execute on function public.get_reconciliation_summary(uuid[], text) to authenticated;
