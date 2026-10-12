-- Feedback files are uploaded straight to storage before the message is saved,
-- so a failed or abandoned send can leave files no attachment row points at.
-- This lists them so a daily job (/api/cron/cleanup-feedback-files) can delete
-- them through the Storage API (storage.objects cannot be deleted from SQL).
--
-- Only files older than the grace period are returned, so an upload that is
-- still being sent is never touched. Service role only: the files of other
-- users' unsent messages must not be listable by anyone else.
create or replace function public.get_orphan_feedback_files(p_older_than interval default interval '24 hours')
returns setof text
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'feedback-files'
    and o.created_at < now() - p_older_than
    and not exists (select 1 from self_audit_feedback_attachments a where a.storage_path = o.name)
  order by o.created_at
  limit 1000;
$$;

revoke all on function public.get_orphan_feedback_files(interval) from public, anon, authenticated;
grant execute on function public.get_orphan_feedback_files(interval) to service_role;
