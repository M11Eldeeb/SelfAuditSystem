-- Sub-dealer WIPs match on the base work order number: a "-1" / "-2" follow-up job card of a listed WIP is the sub-dealer's
-- too (the sheet lists 12345; the Heraa claim 12345-1 is a sub-dealer WIP). The list table holds base numbers only
-- (HER-12345); a claim's work order is reduced the same way - the branch code goes in front of a bare number, the
-- "-<n>" suffix comes off - before it is compared.

create or replace function public.get_sub_dealer_claim_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select n.claim_id
  from (
    select s.claim_id,
           upper(regexp_replace(btrim(s.work_order_no), '\s+', '', 'g')) as wo,
           upper(b.code) as code
    from self_audit_claim_settlement s
    left join self_audit_branches b on b.id = s.branch_id
    where s.work_order_no is not null
  ) n
  where regexp_replace(case when n.wo ~ '^[0-9]' then coalesce(n.code, '') || '-' || n.wo else n.wo end, '^([A-Z]{2,4}-[0-9]+)-[0-9]+$', '\1')
        in (select work_order from self_audit_sub_dealer_wips);
$function$;

revoke all on function public.get_sub_dealer_claim_ids() from public, anon;
grant execute on function public.get_sub_dealer_claim_ids() to authenticated, service_role;
