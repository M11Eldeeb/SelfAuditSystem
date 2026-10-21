-- The claims sheet has no part-name column (only "Part No": one or several numbers separated by ";"), so
-- self_audit_claims.main_part_name is empty. The names come from the Part Details sheet (self_audit_claim_parts).
-- claim_main_part_name(claim) works the main part out when it is read, so a new upload shows it with no extra step:
-- the first part number on the claim -> its name from this claim's own Part Details rows -> the name any other claim
-- has for the same part number -> the part number itself.
-- It is not stored in self_audit_claims on purpose: main_part_name is part of the claim fingerprint the incremental
-- upload compares, and rewriting 62,000 wide rows would slow the upload down.
create index if not exists self_audit_claim_parts_part_no_idx on public.self_audit_claim_parts (part_no);

create or replace function public.claim_main_part_name(c public.self_audit_claims)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim(c.main_part_name), ''),
    (select cp.part_name from self_audit_claim_parts cp where cp.claim_id = c.id and cp.part_no = f.p and cp.part_name is not null limit 1),
    (select cp.part_name from self_audit_claim_parts cp where cp.part_no = f.p and cp.part_name is not null limit 1),
    f.p
  )
  from (select nullif(btrim(regexp_replace(split_part(coalesce(c.raw_row->>'Part No', ''), ';', 1), '^\s*#', '')), '') as p) f;
$$;

-- The same name for a list of claims, for pages that load a few dozen claims at once.
create or replace function public.claims_main_part_names(p_claim_ids uuid[])
returns table (claim_id uuid, main_part_name text)
language sql
stable
set search_path = public
as $$
  select c.id, claim_main_part_name(c) from self_audit_claims c where c.id = any(p_claim_ids);
$$;

-- The upcoming internal audit sheet shows the same name.
do $$
declare d text;
begin
  select pg_get_functiondef('public.get_upcoming_internal_audit_claims(uuid)'::regprocedure) into d;
  if position('cl.main_part_name' in d) = 0 then raise exception 'get_upcoming_internal_audit_claims: main_part_name not found'; end if;
  execute replace(d, 'cl.main_part_name', 'claim_main_part_name(cl)');
end $$;
