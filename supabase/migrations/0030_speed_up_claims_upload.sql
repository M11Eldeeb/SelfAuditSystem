-- Two real, measured bottlenecks in the claims/Warranty Room upload path
-- (confirmed via pg_stat_statements, not guessed):
--
-- 1. upload_batch_id has no index on any of the 4 tables that filter or
--    join by it - already flagged by Supabase's own advisor (unindexed
--    foreign key) and never acted on. finishUpload's own
--    `.eq("upload_batch_id", batchId)` / `.neq(...)` queries were forcing a
--    sequential scan of a 60k+-row table on every one of the ~61 paginated
--    pages selectAllRows needed to read it.
--
-- 2. finishUpload (src/lib/upload-claims.ts) computed the batch's branch set
--    and the stale-claim list entirely in JS: paginate the whole batch
--    (selectAllRows, 1000 rows/page - ~61 round trips for 60k claims),
--    paginate every audit_assignment on file, paginate every non-batch
--    claim in those branches, then delete in 500-row chunks. That's
--    100+ sequential round trips for one upload's cleanup step alone, most
--    of them fetching thousands of rows just to compute a small set
--    client-side. Replaced with one function that does the same
--    exclusion/delete server-side and returns just the deleted count.

create index if not exists claims_upload_batch_idx on public.self_audit_claims (upload_batch_id);
create index if not exists claim_parts_upload_batch_idx on public.self_audit_claim_parts (upload_batch_id);
create index if not exists scrap_requests_upload_batch_idx on public.self_audit_scrap_requests (upload_batch_id);
create index if not exists scrapped_parts_upload_batch_idx on public.self_audit_scrapped_parts (upload_batch_id);

-- security definer bypasses RLS, so the officer-only check is done by hand,
-- same pattern as every other RPC in this project.
create or replace function public.finish_claims_upload(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted_count integer;
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  with batch_branches as (
    select distinct branch_id
    from self_audit_claims
    where upload_batch_id = p_batch_id
  ),
  stale as (
    select c.id
    from self_audit_claims c
    where c.upload_batch_id is distinct from p_batch_id
      and c.branch_id in (select branch_id from batch_branches)
      and not exists (
        select 1 from self_audit_audit_assignments a where a.claim_id = c.id
      )
  )
  delete from self_audit_claims
  where id in (select id from stale);

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;
