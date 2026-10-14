-- The kept-claims table is filled right before finish_claims_upload runs, so autovacuum has not analysed it yet and
-- the planner guessed badly (the stale search took ~20 s instead of ~40 ms). Analyse it first.

create or replace function public.finish_claims_upload(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted_count integer;
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  analyze self_audit_upload_batch_kept_claims;

  with batch_branches as (
    select distinct branch_id from self_audit_claims where upload_batch_id = p_batch_id
    union
    select distinct branch_id from self_audit_upload_batch_kept_claims where batch_id = p_batch_id
  ),
  stale as (
    select c.id
    from self_audit_claims c
    where c.branch_id in (select branch_id from batch_branches)
      and not exists (select 1 from self_audit_upload_batch_kept_claims k where k.batch_id = p_batch_id and k.claim_id = c.id)
      and not exists (select 1 from self_audit_claims t where t.id = c.id and t.upload_batch_id = p_batch_id)
      and not exists (
        select 1 from self_audit_audit_assignments a where a.claim_id = c.id
      )
  )
  delete from self_audit_claims
  where id in (select id from stale);

  get diagnostics v_deleted_count = row_count;

  delete from self_audit_upload_batch_kept_claims where batch_id <> p_batch_id;

  return v_deleted_count;
end;
$$;
