-- Gross claim amount per SAIC settlement order, for the officer's 3-month
-- forecast on Claims & Financials. One order at a time through the
-- settlement-order expression index (~0.7s each); the app caches the whole
-- history for a day. Service role only - the app calls it after checking
-- the viewer is an officer.
create or replace function public.get_settlement_order_totals(p_order text)
returns table (settlement_order text, claim_count bigint, gross_amount numeric, adjusted_amount numeric)
language sql
stable
set search_path = public
as $$
  select p_order,
         count(*),
         coalesce(sum(c.claim_amount), 0),
         coalesce(sum(coalesce(safe_numeric(c.raw_row->>'Adjusted Claim TOL.'), c.claim_amount)), 0)
  from self_audit_claims c
  where c.raw_row->>'Settlement Order' = p_order
    and c.raw_row->>'Status' = 'Settled';
$$;

revoke all on function public.get_settlement_order_totals(text) from public, anon, authenticated;
grant execute on function public.get_settlement_order_totals(text) to service_role;

-- Settlement order list for the service role too (get_settlement_orders
-- itself checks for an officer session, which the cached loader has none of).
create or replace function public.list_settlement_orders()
returns table (settlement_order text)
language sql
stable
set search_path = public
as $$
  with recursive orders(o) as (
    (select c.raw_row->>'Settlement Order' from self_audit_claims c
      where c.raw_row->>'Settlement Order' is not null
      order by c.raw_row->>'Settlement Order' desc limit 1)
    union all
    select (select c.raw_row->>'Settlement Order' from self_audit_claims c
              where c.raw_row->>'Settlement Order' is not null and c.raw_row->>'Settlement Order' < orders.o
              order by c.raw_row->>'Settlement Order' desc limit 1)
    from orders where orders.o is not null
  )
  select o from orders where o is not null;
$$;

revoke all on function public.list_settlement_orders() from public, anon, authenticated;
grant execute on function public.list_settlement_orders() to service_role;
