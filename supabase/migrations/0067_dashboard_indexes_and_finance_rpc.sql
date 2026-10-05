-- KPI dashboard filters claims by branch + repair end date month. Without an
-- index that's a full scan of self_audit_claims (wide rows - raw_row carries
-- the whole export row), measured at ~11.5s, past the 8s statement timeout.
create index if not exists self_audit_claims_branch_repair_end_idx
  on self_audit_claims (branch_id, repair_end_date);

-- Finance summary: submitted claims that aren't closed, settled or rejected.
-- That's ~5% of all claims, so a partial index on exactly this predicate
-- (repeated verbatim in get_finance_summary below so the planner can use
-- it) avoids scanning the rest.
create index if not exists self_audit_claims_finance_open_idx
  on self_audit_claims (id)
  where raw_row->>'First Submit Date' is not null
    and raw_row->>'Status' not in ('Closed', 'Settled', 'Rejected', 'Rejected from Chief Agent', 'Rejected from chief agent');

-- Total "Adjusted Claim TOL." per First Submit Date year-month. Security
-- definer since finance accounts have no branch (claims RLS returns nothing
-- for them) - the role check below is what limits it to finance + officers,
-- and only these aggregates are returned, never claim rows.
create or replace function public.get_finance_summary()
returns table (month text, claim_count bigint, total_adjusted numeric, currency text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(current_user_role()::text, '') not in ('finance', 'officer') then
    raise exception 'Not authorized';
  end if;

  return query
  select
    left(replace(c.raw_row->>'First Submit Date', '/', '-'), 7) as month,
    count(*) as claim_count,
    coalesce(sum(nullif(c.raw_row->>'Adjusted Claim TOL.', '')::numeric), 0) as total_adjusted,
    mode() within group (order by c.raw_row->>'currency') as currency
  from self_audit_claims c
  where c.raw_row->>'First Submit Date' is not null
    and c.raw_row->>'Status' not in ('Closed', 'Settled', 'Rejected', 'Rejected from Chief Agent', 'Rejected from chief agent')
  group by 1
  order by 1 desc;
end;
$$;

revoke all on function public.get_finance_summary() from public, anon;
grant execute on function public.get_finance_summary() to authenticated;
