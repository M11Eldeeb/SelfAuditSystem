-- The scheduled mails and daily housekeeping now run from the database scheduler (pg_cron) instead of Vercel's cron.
-- Vercel's free plan only promises to run a job "sometime in the hour", so a 08:30 reminder could arrive at 08:59.
-- pg_cron starts the job on the minute (UTC) and calls the same /api/cron routes, sending a secret kept in
-- self_audit_cron_secret (nobody but the server can read it). The jobs are idempotent (a mail already sent is skipped),
-- so the second call of the day is only insurance in case the first one failed.
create table if not exists public.self_audit_cron_secret (
  id int primary key check (id = 1),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
alter table public.self_audit_cron_secret enable row level security;
revoke all on public.self_audit_cron_secret from anon, authenticated;
insert into public.self_audit_cron_secret (id) values (1) on conflict (id) do nothing;

create extension if not exists pg_net;

create or replace function public.call_cron_route(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id bigint;
begin
  select secret into v_secret from self_audit_cron_secret where id = 1;
  select net.http_get(
    url := 'https://self-audit-system.vercel.app' || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 58000
  ) into v_id;
  return v_id;
end;
$$;
revoke all on function public.call_cron_route(text) from public, anon, authenticated;

-- Sunday to Thursday (Saudi working week), UTC: 05:30 = 08:30 and 06:00 = 09:00 in Saudi Arabia.
select cron.schedule('self-audit-mail-reminders', '30 5 * * 0-4', $$select public.call_cron_route('/api/cron/mail-reminders')$$);
select cron.schedule('self-audit-mail-reminders-retry', '30 8 * * 0-4', $$select public.call_cron_route('/api/cron/mail-reminders')$$);
select cron.schedule('self-audit-daily-housekeeping', '0 6 * * 0-4', $$select public.call_cron_route('/api/cron/daily-housekeeping')$$);
select cron.schedule('self-audit-daily-housekeeping-retry', '30 8 * * 0-4', $$select public.call_cron_route('/api/cron/daily-housekeeping')$$);
