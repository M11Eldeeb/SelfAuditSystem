-- 0102's finish_claims_upload had to read every claim row (~200 MB) to find the stale ones, ~18 s on this tier - far
-- over the 8 s limit. The kept-claims table now also stores each claim's branch, and the stale search is written so
-- Postgres can answer it from the narrow indexes (claims_manifest_idx) and only touches a claim's row when the claim
-- is neither listed nor tagged with the batch.

drop table if exists public.self_audit_upload_batch_kept_claims;

create table public.self_audit_upload_batch_kept_claims (
  batch_id uuid not null references public.self_audit_upload_batches (id) on delete cascade,
  claim_id uuid not null,
  branch_id uuid not null,
  primary key (batch_id, claim_id)
);

alter table public.self_audit_upload_batch_kept_claims enable row level security;
create policy "officers read kept claims" on public.self_audit_upload_batch_kept_claims for select
  using ((select current_user_role()) = 'officer');

create or replace function public.add_kept_claims(p_batch_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() is distinct from 'officer' then
    raise exception 'Not authorized.';
  end if;

  insert into self_audit_upload_batch_kept_claims (batch_id, claim_id, branch_id)
  select p_batch_id, c.id, c.branch_id
  from self_audit_claims c
  where c.id = any(p_ids)
  on conflict do nothing;
end;
$$;

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

  -- Only the latest upload's list matters; earlier ones (and half-finished attempts) are dropped here.
  delete from self_audit_upload_batch_kept_claims where batch_id <> p_batch_id;

  return v_deleted_count;
end;
$$;
