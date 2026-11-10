-- Security hardening.
-- 1. Nobody without a login may call a database function through the API (the anon key is public by design).
--    Functions that belong to extensions (pg_net, ...) are left alone. The small "who am I" helpers that table
--    policies call (current_user_role, hub_is_admin, ...) stay callable - they say nothing to a signed-out caller,
--    and without them every signed-out read of a table with such a policy would fail instead of returning nothing.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn,
           exists (select 1 from pg_policies pol
                   where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\m' || p.proname || '\(')) as in_policy
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if r.in_policy then
      execute format('revoke execute on function %s from public', r.fn);
      execute format('grant execute on function %s to anon, authenticated, service_role', r.fn);
    else
      execute format('revoke execute on function %s from public, anon', r.fn);
      execute format('grant execute on function %s to authenticated, service_role', r.fn);
    end if;
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;

-- 2. Internal helpers only the database itself uses (from other functions): not callable by signed-in users either.
revoke execute on function public.cache_needs_refresh(text, text[]) from authenticated;
revoke execute on function public.cache_source_fingerprint(text[]) from authenticated;

-- 3. A fixed search_path on every function that lacked one (no object can be slipped in ahead of public).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.fn);
  end loop;
end $$;

-- 4. Upload limits on the storage buckets that had none (size and file types).
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/*', 'application/pdf'] where id = 'audit-photos';
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/*', 'video/*', 'application/pdf'] where id = 'warranty-room-files';
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/*'] where id = 'verification-photos';

-- 5. Failed sign-ins, for the login rate limit (server only - no policies).
create table if not exists public.self_audit_login_failures (
  id bigint generated always as identity primary key,
  key text not null,
  at timestamptz not null default now()
);
alter table public.self_audit_login_failures enable row level security;
create index if not exists self_audit_login_failures_key_at on public.self_audit_login_failures (key, at desc);
