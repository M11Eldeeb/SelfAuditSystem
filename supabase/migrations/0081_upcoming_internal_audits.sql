-- A branch admin is told about an internal audit coming to their branch and can
-- download the list of claims that will be audited. Branch admins can only read
-- FINALIZED internal audits through RLS, so these two read functions expose the
-- narrow slice needed for an in-progress audit of their OWN branch: its name,
-- date and claim count, and the claim identification columns for the sheet
-- (never the risk score or anything the officer keeps internal).
--
-- "Upcoming" = in progress and its date is today or later (or not set yet),
-- by Saudi calendar date.

create or replace function public.get_upcoming_internal_audits()
returns table (id uuid, name text, audit_date date, claim_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ia.id, ia.name, ia.audit_date,
         (select count(*) from self_audit_internal_audit_claims c where c.internal_audit_id = ia.id)
  from self_audit_internal_audits ia
  where current_user_role() is not distinct from 'branch_admin'
    and ia.branch_id = current_user_branch_id()
    and ia.status = 'in_progress'
    and (ia.audit_date is null or ia.audit_date >= (now() at time zone 'Asia/Riyadh')::date)
  order by ia.audit_date nulls last, ia.created_at;
$$;

create or replace function public.get_upcoming_internal_audit_claims(p_audit_id uuid)
returns table (
  claim_number text,
  work_order_no text,
  vin text,
  main_part_name text,
  creation_date date,
  repair_end_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select cl.claim_number, cl.work_order_no, cl.vin, cl.main_part_name, cl.creation_date, cl.repair_end_date
  from self_audit_internal_audits ia
  join self_audit_internal_audit_claims iac on iac.internal_audit_id = ia.id
  join self_audit_claims cl on cl.id = iac.claim_id
  where ia.id = p_audit_id
    and current_user_role() is not distinct from 'branch_admin'
    and ia.branch_id = current_user_branch_id()
    and ia.status = 'in_progress'
  order by iac.sort_order;
$$;

revoke all on function public.get_upcoming_internal_audits() from public, anon;
revoke all on function public.get_upcoming_internal_audit_claims(uuid) from public, anon;
grant execute on function public.get_upcoming_internal_audits() to authenticated;
grant execute on function public.get_upcoming_internal_audit_claims(uuid) to authenticated;
