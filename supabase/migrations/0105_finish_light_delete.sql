-- finish_claims_upload speed-up, found by timing it on the real 62,000-claim table:
--  * claims_upload_batch_idx becomes a covering index (id, branch_id included) so "which claims / branches are in this
--    batch" is answered from the index instead of reading every claim row;
--  * the stale ids are collected first and the DELETE only runs when there is something to delete (normally nothing).

create index if not exists claims_upload_batch_cov_idx on public.self_audit_claims (upload_batch_id) include (id, branch_id);
drop index if exists public.claims_upload_batch_idx;

create or replace function public.finish_claims_upload(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stale uuid[];
  v_deleted_count integer := 0;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  -- The list was filled a moment ago, so autovacuum has not analysed it; without statistics the planner guesses badly.
  analyze self_audit_upload_batch_kept_claims;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_stale
  from self_audit_claims c
  where c.branch_id in (
      select branch_id from self_audit_claims where upload_batch_id = p_batch_id
      union
      select branch_id from self_audit_upload_batch_kept_claims where batch_id = p_batch_id
    )
    and not exists (select 1 from self_audit_upload_batch_kept_claims k where k.batch_id = p_batch_id and k.claim_id = c.id)
    and not exists (select 1 from self_audit_claims t where t.id = c.id and t.upload_batch_id = p_batch_id)
    and not exists (select 1 from self_audit_audit_assignments a where a.claim_id = c.id);

  if cardinality(v_stale) > 0 then
    delete from self_audit_claims where id = any(v_stale);
    get diagnostics v_deleted_count = row_count;
  end if;

  -- Only the latest upload's list matters; earlier ones (and half-finished attempts) are dropped here.
  delete from self_audit_upload_batch_kept_claims where batch_id <> p_batch_id;

  return v_deleted_count;
end;
$$;
