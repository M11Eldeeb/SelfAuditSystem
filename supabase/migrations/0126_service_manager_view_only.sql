-- View-only access.
--  * Service manager (new role, value added by migration "service_manager_enum"): sees exactly what the branch's
--    warranty admin sees, for their own branch, and can change nothing.
--  * view_all: a user (amr.abdelhafez@jiadmotors.com, technical team) who also sees everything a warranty officer sees,
--    read only - he still acts in Technical Inquiries / Verification Codes as the technical team member he is.
-- Reads: current_user_role() answers 'branch_admin' for a service manager and 'officer' for a view_all user, so every
-- existing read policy lets them see the same rows. Writes: the API's pre-request hook (view_only_guard) makes their
-- requests read-only transactions (Technical Inquiries / Verification Codes excepted for view_all users), and the
-- website refuses their actions before they reach the database.
alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text in ('branch_admin', 'workshop_supervisor', 'team_leader', 'service_manager') and branch_id is not null)
  or role::text in ('officer', 'finance', 'technical')
);
alter table self_audit_users add column if not exists view_all boolean not null default false;

create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select case
    when role::text = 'service_manager' then 'branch_admin'::user_role
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
  if r.role = 'service_manager' or (r.view_all and r.role <> 'officer' and p !~* '(inquir|verification)') then
    set transaction read only;
  end if;
end;
$$;
grant execute on function public.view_only_guard() to authenticated, anon;

update self_audit_users set view_all = true where lower(email) = 'amr.abdelhafez@jiadmotors.com';

-- Run the guard before every API request.
alter role authenticator set pgrst.db_pre_request = 'public.view_only_guard';
notify pgrst, 'reload config';
