-- promote_stale_scrap_requests (migration 0043) is security definer with no
-- internal role check, unlike every other privileged RPC in this schema
-- (e.g. generate_scrap_requests_chunk). Any signed-in user could call it
-- directly and prematurely mark real pending scrap requests as
-- presumed_scrapped, hiding them from the branch admin before a video was
-- ever submitted. Restrict it to officers, same as the claims-upload flow
-- that's meant to be its only caller.
create or replace function public.promote_stale_scrap_requests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  with promoted as (
    update self_audit_scrap_requests
    set status = 'presumed_scrapped'
    where status = 'pending'
    returning id
  )
  select count(*)::integer into v_count from promoted;

  return v_count;
end;
$$;
