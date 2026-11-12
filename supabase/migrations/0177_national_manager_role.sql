-- National Manager: a view-only account that sees the warranty officer's dashboard for EVERY branch (with a shorter menu).
-- Same plumbing as the Manager role: reads see what an officer sees, the API's pre-request hook makes the requests
-- read-only transactions, and the website refuses their actions before they reach the database.
alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text in ('branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager', 'technician', 'claims_reviewer', 'service_advisor', 'quality_controller') and branch_id is not null)
  or role::text in ('officer', 'finance', 'technical', 'manager', 'national_manager')
);

create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select case
    when role::text = 'service_manager' then 'branch_admin'::user_role
    when role::text in ('manager', 'national_manager') then 'officer'::user_role
    when view_all and role::text <> 'officer' then 'officer'::user_role
    else role
  end
  from self_audit_users where id = auth.uid();
$$;

create or replace function public.view_only_guard()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  p text := coalesce(current_setting('request.path', true), '');
begin
  if auth.uid() is null then
    return;
  end if;
  select u.role::text as role, u.view_all into r from self_audit_users u where u.id = auth.uid();
  if not found then
    return;
  end if;
  if r.role in ('service_manager', 'manager', 'national_manager') or (r.view_all and r.role <> 'officer' and p !~* '(inquir|verification)') then
    set transaction read only;
  end if;
end;
$$;
