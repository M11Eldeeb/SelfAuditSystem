-- The portal's address is now https://mgwarranty.vercel.app (the old self-audit-system.vercel.app still works): the scheduled
-- jobs call the new one, so links inside automatic e-mails use it.
create or replace function public.call_cron_route(p_path text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_id bigint;
begin
  select secret into v_secret from self_audit_cron_secret where id = 1;
  select net.http_get(
    url := 'https://mgwarranty.vercel.app' || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 58000
  ) into v_id;
  return v_id;
end;
$$;
