-- Incremental claims upload.
--
-- A monthly export re-sends ~62,000 claims, most of them unchanged, and every one of them used to be rewritten
-- (3 KB row + 10 indexes each), which is what made the upload slow and prone to statement timeouts on the free tier.
-- Now the browser asks for the hash of every claim already stored, and only sends the claims that are new or changed.
--
-- The unchanged claims keep their old upload_batch_id, so "the claims of the latest upload" is no longer just
-- "rows tagged with the latest batch": the batch also remembers the ids it left untouched (kept_claim_ids).
-- Both readers of that idea - finish_claims_upload (stale cleanup) and the self-audit cycle generation - use
-- "tagged with the batch OR listed in kept_claim_ids", which is exactly the set a full re-upload would have produced.

alter table public.self_audit_claims add column if not exists source_hash text;
alter table public.self_audit_upload_batches add column if not exists kept_claim_ids uuid[];

-- Unchanged claims now keep pointing at older batches. With ON DELETE CASCADE, deleting an old batch row would
-- silently delete those claims; make it fail instead.
alter table public.self_audit_claims drop constraint claims_upload_batch_id_fkey;
alter table public.self_audit_claims
  add constraint claims_upload_batch_id_fkey foreign key (upload_batch_id) references public.self_audit_upload_batches (id) on delete restrict not valid;
alter table public.self_audit_claims validate constraint claims_upload_batch_id_fkey;

-- (id, claim_number, source_hash) of every stored claim of one branch, as one json array (a set-returning function
-- would be cut off at the API's row limit).
create or replace function public.claims_upload_manifest(p_branch_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_array(c.id, c.claim_number, c.source_hash)), '[]'::jsonb)
  from self_audit_claims c
  where c.branch_id = p_branch_id;
$$;

-- Records the claims an upload left untouched because they were identical. Safe to repeat.
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

  update self_audit_upload_batches b
  set kept_claim_ids = array(
    select distinct x
    from unnest(coalesce(b.kept_claim_ids, '{}'::uuid[]) || coalesce((select array_agg(c.id) from self_audit_claims c where c.id = any(p_ids)), '{}'::uuid[])) x
  )
  where b.id = p_batch_id;
end;
$$;

-- Same job and rules as before (drop claims that are no longer in the file, only for the branches the file covers,
-- never one that is tied to an audit assignment) - but a claim counts as "in the file" when it is tagged with the
-- batch or was left untouched by it.
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

  with kept as (
    select unnest(b.kept_claim_ids) as id
    from self_audit_upload_batches b
    where b.id = p_batch_id
  ),
  batch_branches as (
    select distinct branch_id from self_audit_claims where upload_batch_id = p_batch_id
    union
    select distinct c.branch_id from self_audit_claims c join kept k on k.id = c.id
  ),
  stale as (
    select c.id
    from self_audit_claims c
    where c.upload_batch_id is distinct from p_batch_id
      and not exists (select 1 from kept k where k.id = c.id)
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

-- The claims one branch can draw its self-audit sample from: those in the latest claims upload (see above),
-- with parts, created inside the claims month.
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
      or c.id in (select unnest(b.kept_claim_ids) from self_audit_upload_batches b where b.id = p_batch_id)
    );
$$;
