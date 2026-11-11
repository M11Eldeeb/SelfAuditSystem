-- Sub-dealer WIPs must match on the work order base number AND the VIN: the WIP counter restarts after 8000, so the same
-- number can come back for another car. The list now holds one row per (base work order, VIN); the next sync (every
-- 30 minutes, or on demand) refills it from the sub-dealer's sheet.

delete from self_audit_sub_dealer_wips;
alter table self_audit_sub_dealer_wips drop constraint self_audit_sub_dealer_wips_pkey;
alter table self_audit_sub_dealer_wips add column vin text not null default '';
alter table self_audit_sub_dealer_wips alter column vin drop default;
alter table self_audit_sub_dealer_wips add primary key (work_order, vin);

create or replace function public.get_sub_dealer_claim_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with cand as materialized (
    -- claims whose base work order is listed (small), then their VIN is checked
    select n.claim_id, n.base
    from (
      select s.claim_id,
             regexp_replace(
               case when upper(regexp_replace(btrim(s.work_order_no), '\s+', '', 'g')) ~ '^[0-9]'
                    then coalesce(upper(b.code), '') || '-' || upper(regexp_replace(btrim(s.work_order_no), '\s+', '', 'g'))
                    else upper(regexp_replace(btrim(s.work_order_no), '\s+', '', 'g')) end,
               '^([A-Z]{2,4}-[0-9]+)-[0-9]+$', '\1') as base
      from self_audit_claim_settlement s
      left join self_audit_branches b on b.id = s.branch_id
      where s.work_order_no is not null
    ) n
    where n.base in (select work_order from self_audit_sub_dealer_wips)
  )
  select cand.claim_id
  from cand
  join self_audit_claims c on c.id = cand.claim_id
  where exists (
    select 1 from self_audit_sub_dealer_wips w
    where w.work_order = cand.base and w.vin = upper(regexp_replace(btrim(coalesce(c.vin, '')), '\s+', '', 'g'))
  );
$function$;

revoke all on function public.get_sub_dealer_claim_ids() from public, anon;
grant execute on function public.get_sub_dealer_claim_ids() to authenticated, service_role;
