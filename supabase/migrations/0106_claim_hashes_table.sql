-- Incremental claims upload, take 2.
--
-- 0100-0105 stored a hash on the claims table itself (source_hash) and the upload compared against it. That made every
-- write heavier (two more wide indexes) and, worse, comparing "file vs database" by reading the claim rows is slow on
-- this project: the free-tier disk delivers ~2 MB/s once its burst budget is spent, and the claims heap is 200 MB.
--
-- Now a narrow side table holds one fingerprint per claim. A trigger on self_audit_claims recomputes it from the row
-- that was actually written, so it can never be out of date, whoever writes the claims. The upload reads only this
-- table (~10 MB) to decide which claims are new or changed.

-- The fingerprint: sha-256 of "<small columns as jsonb text>|<raw_row jsonb text>", first 128 bits. The browser builds
-- the identical text (src/lib/warranty-room/claims-diff.ts).
create or replace function public.claim_fingerprint(c public.self_audit_claims)
returns uuid
language sql
immutable
as $$
  select substr(encode(sha256(convert_to(
    jsonb_build_object(
      'branch_id', c.branch_id, 'claim_number', c.claim_number, 'work_order_no', c.work_order_no, 'has_parts', c.has_parts,
      'vin', c.vin, 'vehicle_model', c.vehicle_model, 'mileage', c.mileage, 'part_serial_number', c.part_serial_number,
      'part_production_date', c.part_production_date, 'repair_end_date', c.repair_end_date, 'dealer_submit_date', c.dealer_submit_date,
      'creation_date', c.creation_date, 'claim_amount', c.claim_amount, 'prior_approval', c.prior_approval, 'return_times', c.return_times,
      'return_times_dealer', c.return_times_dealer, 'labor_code', c.labor_code, 'main_part_name', c.main_part_name,
      'verification_date', c.verification_date
    )::text || '|' || c.raw_row::text, 'UTF8')), 'hex'), 1, 32)::uuid;
$$;

create table if not exists public.self_audit_claim_hashes (
  claim_id uuid primary key references public.self_audit_claims (id) on delete cascade,
  branch_id uuid not null,
  claim_number text not null,
  hash uuid not null,
  unique (branch_id, claim_number)
);

alter table public.self_audit_claim_hashes enable row level security;
create policy "officers read claim hashes" on public.self_audit_claim_hashes for select
  using ((select current_user_role()) = 'officer');

create or replace function public.sync_claim_hash()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into self_audit_claim_hashes (claim_id, branch_id, claim_number, hash)
  values (new.id, new.branch_id, new.claim_number, claim_fingerprint(new))
  on conflict (claim_id) do update
    set branch_id = excluded.branch_id, claim_number = excluded.claim_number, hash = excluded.hash;
  return null;
end;
$$;

drop trigger if exists claims_sync_hash on public.self_audit_claims;
create trigger claims_sync_hash
  after insert or update on public.self_audit_claims
  for each row execute function public.sync_claim_hash();

-- One page of (branch_id, claim_number, claim id, fingerprint), in key order, after the given key.
create or replace function public.claims_hash_manifest(p_after_branch uuid default null, p_after_number text default null, p_limit integer default 4000)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_array(h.branch_id, h.claim_number, h.claim_id, h.hash) order by h.branch_id, h.claim_number), '[]'::jsonb)
  from (
    select branch_id, claim_number, claim_id, hash
    from self_audit_claim_hashes
    where p_after_branch is null or (branch_id, claim_number) > (p_after_branch, p_after_number)
    order by branch_id, claim_number
    limit least(greatest(p_limit, 1), 10000)
  ) h;
$$;

-- Fingerprints for the claims that already exist (done in ctid ranges on the live database, ~100 s on this tier).
insert into public.self_audit_claim_hashes (claim_id, branch_id, claim_number, hash)
select c.id, c.branch_id, c.claim_number, public.claim_fingerprint(c)
from public.self_audit_claims c
on conflict (claim_id) do nothing;
