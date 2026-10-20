-- A branch admin's case no longer goes straight to the technical team: like a team leader's, it waits for the workshop
-- supervisor of the branch (when the branch has one). Only the workshop supervisor (or an officer) verifies, sends back
-- or returns a case - no longer the branch admin.
create or replace function public.inquiry_needs_verification(p_role text, p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_role in ('team_leader', 'branch_admin')
     and exists (select 1 from self_audit_users u where u.role::text = 'workshop_supervisor' and u.branch_id = p_branch_id);
$$;

do $$
declare d text; n text;
begin
  for n in select unnest(array['verify_technical_inquiry', 'reject_technical_inquiry', 'return_technical_inquiry']) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    if position('a.role in (''workshop_supervisor'', ''branch_admin'')' in d) = 0 then raise exception '%: role list not found', n; end if;
    d := replace(d, 'a.role in (''workshop_supervisor'', ''branch_admin'')', 'a.role = ''workshop_supervisor''');
    execute d;
  end loop;
end $$;
