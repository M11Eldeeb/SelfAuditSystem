-- Sub-dealer WIPs: some Heraa (HER) work orders are warranty job cards done for a sub-dealer. The sub-dealer's live Google
-- Sheet ("Warranty Desk - live data", tabs Claims and Free Service, column "Work Order (Dealer)") lists them. The portal
-- keeps a copy of that list (refreshed every 30 minutes), marks those WIPs "Sub-Dealer WIP", and leaves their claims out
-- of the self audits and the internal audits (they are not the Heraa branch's own work).

create table if not exists self_audit_sub_dealer_wips (
  work_order text primary key,            -- normalised: upper case, no spaces, branch code in front (HER-44846)
  source_tab text not null,               -- Claims / Free Service
  sub_dealer_wo text,                     -- the sub-dealer's own work order (NAG-5622)
  synced_at timestamptz not null default now()
);
alter table self_audit_sub_dealer_wips enable row level security;

create table if not exists self_audit_sub_dealer_sync (
  id integer primary key check (id = 1),
  synced_at timestamptz,
  wip_count integer not null default 0,
  removed_assignments integer not null default 0,
  removed_internal_claims integer not null default 0,
  last_error text
);
alter table self_audit_sub_dealer_sync enable row level security;

-- Claims whose work order is a sub-dealer WIP (the narrow settlement table carries every claim's work order).
create or replace function public.get_sub_dealer_claim_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select s.claim_id
  from self_audit_claim_settlement s
  where s.work_order_no is not null
    and upper(regexp_replace(btrim(s.work_order_no), '\s+', '', 'g')) in (select work_order from self_audit_sub_dealer_wips);
$function$;

revoke all on function public.get_sub_dealer_claim_ids() from public, anon;
grant execute on function public.get_sub_dealer_claim_ids() to authenticated, service_role;

-- Every 30 minutes (the sub-dealer's sheet refreshes itself about every 15 minutes).
select cron.schedule('self-audit-sub-dealer-wips', '*/30 * * * *', $$select public.call_cron_route('/api/cron/sub-dealer-wips')$$);
