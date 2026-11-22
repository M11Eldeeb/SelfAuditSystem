-- Approving a branch's destroy evidence:
-- 1. scraps every claim still flagged for the branch up to this cycle - this cycle's and those carried over from an
--    earlier cycle (or with no cycle) the branch never submitted - the same claims the "flagged" mail counted;
-- 2. returns the number of PARTS scrapped (it returned claims, so the approval mail said 377 where the first mail said
--    565 parts for the same list).
create or replace function public.approve_destroy_evidence(p_cycle_id uuid, p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_month date;
  v_parts integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  select status into v_status from self_audit_destroy_evidence where cycle_id = p_cycle_id and branch_id = p_branch_id;
  if v_status is null then
    raise exception 'Destroy evidence not found.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'This submission is not awaiting approval.';
  end if;

  select cycle_month into v_month from self_audit_warranty_room_cycles where id = p_cycle_id;

  with scrapped as (
    update self_audit_scrap_requests sr
    set status = 'scrapped', submitted_at = now()
    where sr.branch_id = p_branch_id
      and sr.status = 'pending'
      and (
        sr.cycle_id is null
        or sr.cycle_id = p_cycle_id
        or exists (select 1 from self_audit_warranty_room_cycles w where w.id = sr.cycle_id and w.cycle_month <= v_month)
      )
    returning sr.id
  )
  select count(srp.id) into v_parts
  from scrapped s
  join self_audit_scrap_request_parts srp on srp.scrap_request_id = s.id;

  update self_audit_destroy_evidence
  set status = 'sent', sent_at = now(), sent_by = auth.uid()
  where branch_id = p_branch_id and cycle_id = p_cycle_id;

  return v_parts;
end;
$function$;
