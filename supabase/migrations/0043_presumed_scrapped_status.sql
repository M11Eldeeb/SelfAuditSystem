-- Branch admins were staring at a growing, unmanageable backlog of "awaiting
-- your submission" scrap requests (Jeddah Heraa alone: 686) - almost all of
-- it claims whose 90-day holding period was already exceeded before this
-- automated tracking existed at all, not something a branch can realistically
-- go back and film destruction video for. The officer asked for the pending
-- list to only ever show newly-flagged claims from the most recent claims
-- upload, with everything older automatically treated as already scrapped.
--
-- Adds a third status, 'presumed_scrapped': claims that exceeded their
-- holding period in an EARLIER claims-upload cycle, auto-promoted (no video
-- required) rather than left pending indefinitely. Distinct from 'scrapped'
-- (branch actually submitted destruction video) so the officer's video
-- download folders (/admin/warranty-room/scrap) stay exactly what they are -
-- real video evidence only - and don't fill up with backlog rows that have
-- no video to download.
alter table self_audit_scrap_requests drop constraint self_audit_scrap_requests_status_check;
alter table self_audit_scrap_requests add constraint self_audit_scrap_requests_status_check
  check (status = any (array['pending', 'presumed_scrapped', 'scrapped']));

-- One-time backfill: every scrap request currently pending predates this
-- redesign, so it's exactly the "older than the current cycle" backlog the
-- officer described - promote it now rather than waiting for the next upload.
update self_audit_scrap_requests set status = 'presumed_scrapped' where status = 'pending';

-- Called once at the START of each new "All Claims Data" upload (before any
-- new claim data is written), so the promotion boundary is always "whatever
-- was still pending going into this upload" - cheap, bounded by scrap_requests
-- row count (a few thousand), nowhere near the claims-table timeout territory
-- from migrations 0039-0041.
create or replace function public.promote_stale_scrap_requests()
returns integer
language sql
as $$
  with promoted as (
    update self_audit_scrap_requests
    set status = 'presumed_scrapped'
    where status = 'pending'
    returning id
  )
  select count(*)::integer from promoted;
$$;
