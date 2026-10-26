-- Flagged parts stay flagged until their destroy evidence is approved, however many cycles go by.
-- Generating a new warranty room cycle never touches earlier pending scrap requests (they just stay 'pending'),
-- but approving a cycle's destroy evidence used to scrap only the parts flagged IN that cycle, and the officers' list
-- for a cycle only counted that cycle's own flagged parts. Now a cycle covers everything still flagged for the branch
-- up to and including that cycle:
--   * get_flagged_part_counts(cycle): flagged parts of that cycle and of every earlier one (so a branch that only has
--     carried-over parts still shows up on the new cycle's list);
--   * approve_destroy_evidence(cycle, branch): scraps all of the branch's pending parts from that cycle and earlier
--     ones, and closes the branch's earlier cycles' evidence (they are covered by this one).
create or replace function public.get_flagged_part_counts(p_cycle_id uuid)
returns table (branch_id uuid, claims bigint, parts bigint)
language sql
stable
as $$
  select sr.branch_id, count(distinct sr.id), count(srp.id)
  from self_audit_scrap_requests sr
  left join self_audit_warranty_room_cycles w on w.id = sr.cycle_id
  left join self_audit_scrap_request_parts srp on srp.scrap_request_id = sr.id
  where sr.status = 'pending'
    and (sr.cycle_id is null or w.cycle_month <= (select c.cycle_month from self_audit_warranty_room_cycles c where c.id = p_cycle_id))
  group by sr.branch_id;
$$;

create or replace function public.approve_destroy_evidence(p_cycle_id uuid, p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_month date;
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

  select cycle_month into v_month from self_audit_warranty_room_cycles where id = p_cycle_id;

  with scrapped as (
    update self_audit_scrap_requests sr
    set status = 'scrapped', submitted_at = now()
    where sr.branch_id = p_branch_id
      and sr.status = 'pending'
      and (sr.cycle_id is null or sr.cycle_id in (select w.id from self_audit_warranty_room_cycles w where w.cycle_month <= v_month))
    returning sr.id
  )
  select count(*) into v_scrapped_count from scrapped;

  -- This cycle's evidence is approved; the branch's earlier cycles' evidence is covered by it.
  update self_audit_destroy_evidence
  set status = 'sent', sent_at = now(), sent_by = auth.uid()
  where branch_id = p_branch_id
    and status <> 'sent'
    and cycle_id in (select w.id from self_audit_warranty_room_cycles w where w.cycle_month <= v_month);

  return v_scrapped_count;
end;
$$;
