-- get_settlement_orders (0069) ran as the caller, so the claims RLS policies
-- were applied inside every probe of its loose index scan: 76ms as owner,
-- ~19s as an officer - past the 8s timeout, so the Reconciliation tab got an
-- empty settlement list. Run it as owner instead and check the role here;
-- it only returns settlement order numbers.
create or replace function public.get_settlement_orders()
returns table (settlement_order text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(current_user_role()::text, '') <> 'officer' then
    raise exception 'Not authorized';
  end if;

  return query
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
end;
$$;

revoke all on function public.get_settlement_orders() from public, anon;
grant execute on function public.get_settlement_orders() to authenticated;
