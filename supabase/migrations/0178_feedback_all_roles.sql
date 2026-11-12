-- Feedback for every role: any signed-in user (branch admin, service manager, technician, technical team, workshop,
-- advisor, reviewer, quality controller, manager, national manager) can write to the warranty team and read the replies to
-- their own messages. Until now only a branch admin could (policies checked the role).
--  * Messages: any user may insert a message as themselves (sender_id = their id, their own branch).
--  * Files: any user may upload into their own folder of the feedback-files bucket.
--  * The view-only accounts (service manager, manager, national manager) run read-only requests; sending feedback and marking
--    replies as seen are the two calls they may still make.
drop policy if exists "branch admins send feedback" on self_audit_feedback;
create policy "users send feedback" on self_audit_feedback for insert
  with check (
    sender_id = (select auth.uid())
    and branch_id is not distinct from (select current_user_branch_id())
  );

drop policy if exists "branch admins upload own feedback files" on storage.objects;
create policy "users upload own feedback files" on storage.objects for insert
  with check (
    bucket_id = 'feedback-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

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
  if p ~* '/rpc/(submit_feedback|mark_feedback_replies_seen)$' then
    return;
  end if;
  if r.role in ('service_manager', 'manager', 'national_manager') or (r.view_all and r.role <> 'officer' and p !~* '(inquir|verification)') then
    set transaction read only;
  end if;
end;
$$;
