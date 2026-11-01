-- Destroy evidence is submitted and approved per cycle: approving one cycle scraps only that cycle's flagged parts and
-- closes only that cycle's submission (before, approving a newer cycle also closed every earlier one).
create or replace function public.approve_destroy_evidence(p_cycle_id uuid, p_branch_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text;
  v_scrapped_count integer;
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

  with scrapped as (
    update self_audit_scrap_requests sr
    set status = 'scrapped', submitted_at = now()
    where sr.branch_id = p_branch_id and sr.cycle_id = p_cycle_id and sr.status = 'pending'
    returning sr.id
  )
  select count(*) into v_scrapped_count from scrapped;

  update self_audit_destroy_evidence
  set status = 'sent', sent_at = now(), sent_by = auth.uid()
  where branch_id = p_branch_id and cycle_id = p_cycle_id;

  return v_scrapped_count;
end;
$function$;
