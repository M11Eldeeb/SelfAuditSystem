-- The feedback inbox belongs to the warranty officers. The manager and national manager read as an officer elsewhere,
-- but not here: they only send feedback and read the replies to their own messages (policies "read own ...").
create or replace function public.is_manager_account()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role::text in ('manager', 'national_manager') from self_audit_users where id = auth.uid()), false);
$$;
revoke all on function public.is_manager_account() from public, anon;
grant execute on function public.is_manager_account() to authenticated;

drop policy "officers manage feedback" on self_audit_feedback;
create policy "officers manage feedback" on self_audit_feedback for all
  using ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()))
  with check ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()));

drop policy "officers manage feedback attachments" on self_audit_feedback_attachments;
create policy "officers manage feedback attachments" on self_audit_feedback_attachments for all
  using ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()))
  with check ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()));

drop policy "officers manage feedback replies" on self_audit_feedback_replies;
create policy "officers manage feedback replies" on self_audit_feedback_replies for all
  using ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()))
  with check ((select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()));

drop policy "officers manage feedback files" on storage.objects;
create policy "officers manage feedback files" on storage.objects for all
  using (bucket_id = 'feedback-files' and (select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()))
  with check (bucket_id = 'feedback-files' and (select current_user_role()) is not distinct from 'officer' and not (select is_manager_account()));
