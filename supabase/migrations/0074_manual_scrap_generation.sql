-- Scrap list generation becomes an explicit officer action. Until now the
-- generate-scrap-requests cron ran run_generate_scrap_requests_all() every
-- 10 minutes, so every claims upload (even one only meant for the KPI
-- dashboard) silently added new scrap requests. Now the officer presses
-- "Generate scrap list" on the Warranty Room page, which queues a row here;
-- the cron (every minute) only does the work when one is queued - the job
-- still runs outside the interactive request so it can't hit the 8s
-- statement timeout.

create table if not exists self_audit_scrap_generations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references self_audit_upload_batches (id) on delete set null,
  batch_name text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  requested_by uuid references self_audit_users (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_count integer,
  error text
);

alter table self_audit_scrap_generations enable row level security;
create policy "officers manage scrap_generations" on self_audit_scrap_generations for all
  using ((select current_user_role()) = 'officer') with check ((select current_user_role()) = 'officer');
create policy "authenticated read scrap_generations" on self_audit_scrap_generations for select
  using ((select auth.role()) = 'authenticated');

-- The generation the officer already ran: claims batch of 30 Sep 2026.
insert into self_audit_scrap_generations (batch_id, batch_name, status, requested_at, started_at, finished_at)
select b.id, b.source_filename, 'done', b.uploaded_at, b.uploaded_at, b.uploaded_at
from self_audit_upload_batches b
where b.source_filename = 'WTY_Claims_Batch_Export_20260930061415.xlsx'
order by b.uploaded_at desc
limit 1;

-- Runs one queued generation, if any. Called by the cron every minute.
create or replace function public.run_requested_scrap_generation()
returns void
language plpgsql
as $$
declare
  v_id uuid;
  v_count integer;
begin
  select id into v_id from self_audit_scrap_generations
  where status = 'queued' order by requested_at limit 1
  for update skip locked;
  if v_id is null then return; end if;

  update self_audit_scrap_generations set status = 'running', started_at = now() where id = v_id;
  begin
    v_count := run_generate_scrap_requests_all();
    update self_audit_scrap_generations set status = 'done', finished_at = now(), created_count = v_count where id = v_id;
  exception when others then
    update self_audit_scrap_generations set status = 'failed', finished_at = now(), error = sqlerrm where id = v_id;
  end;
end;
$$;

-- Swap the always-on generation for the queue check.
select cron.unschedule('generate-scrap-requests');
select cron.schedule('generate-scrap-requests', '* * * * *', 'select public.run_requested_scrap_generation();');
