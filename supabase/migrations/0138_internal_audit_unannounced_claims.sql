-- Internal audit: besides the announced claims (sent to the branch beforehand), the officer may add unannounced claims,
-- picked at random, that the branch only learns about at the visit. Scoring treats both the same. The branch side
-- (upcoming audit list, claim count, the notice and its Excel) only ever sees the announced ones.
alter table self_audit_internal_audit_claims add column if not exists announced boolean not null default true;

create or replace function public.get_upcoming_internal_audits()
returns table (id uuid, name text, audit_date date, claim_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ia.id, ia.name, ia.audit_date,
         (select count(*) from self_audit_internal_audit_claims c where c.internal_audit_id = ia.id and c.announced)
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
    and iac.announced
    and current_user_role() is not distinct from 'branch_admin'
    and ia.branch_id = current_user_branch_id()
    and ia.status = 'in_progress'
  order by iac.sort_order;
$$;
