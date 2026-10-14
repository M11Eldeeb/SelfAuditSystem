-- 0100 remembered the claims an upload left untouched in a uuid[] column on the batch. Tested on the real 62,000-claim
-- table that was far too slow to read back (finish ~18 s, the self-audit sample query ~29 s: every lookup has to
-- unpack a 1 MB array). A plain two-column table with a primary key answers the same question with index lookups.

drop function if exists public.cycle_claim_pool(uuid, uuid, date, date);

create table if not exists public.self_audit_upload_batch_kept_claims (
  batch_id uuid not null references public.self_audit_upload_batches (id) on delete cascade,
  claim_id uuid not null,
  primary key (batch_id, claim_id)
);

alter table public.self_audit_upload_batch_kept_claims enable row level security;
create policy "officers read kept claims" on public.self_audit_upload_batch_kept_claims for select
  using ((select current_user_role()) = 'officer');

alter table public.self_audit_upload_batches drop column if exists kept_claim_ids;

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

  insert into self_audit_upload_batch_kept_claims (batch_id, claim_id)
  select p_batch_id, c.id
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
    select distinct c.branch_id
    from self_audit_upload_batch_kept_claims k
    join self_audit_claims c on c.id = k.claim_id
    where k.batch_id = p_batch_id
  ),
  stale as (
    select c.id
    from self_audit_claims c
    where c.upload_batch_id is distinct from p_batch_id
      and not exists (select 1 from self_audit_upload_batch_kept_claims k where k.batch_id = p_batch_id and k.claim_id = c.id)
      and c.branch_id in (select branch_id from batch_branches)
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

create or replace function public.cycle_claim_pool(p_branch_id uuid, p_batch_id uuid, p_from date, p_to date)
returns table (id uuid, raw_row jsonb)
language sql
stable
as $$
  select c.id, c.raw_row
  from self_audit_claims c
  where c.branch_id = p_branch_id
    and c.has_parts = true
    and c.creation_date >= p_from
    and c.creation_date < p_to
    and (
      c.upload_batch_id = p_batch_id
      or exists (select 1 from self_audit_upload_batch_kept_claims k where k.batch_id = p_batch_id and k.claim_id = c.id)
    );
$$;
