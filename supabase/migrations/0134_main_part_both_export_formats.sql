-- The claims export comes in two shapes: "Part No" (every part number, no names) or "Main Part" + "Main Part Name"
-- (the name is then stored in self_audit_claims.main_part_name). Both feed the main part tables and
-- claim_main_part_name(). Rebuilt for the second shape after an upload of it replaced every claim's raw_row.
create or replace function public.sync_claim_main_part()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part text := nullif(btrim(regexp_replace(split_part(coalesce(nullif(new.raw_row->>'Part No', ''), new.raw_row->>'Main Part', ''), ';', 1), '^\s*#', '')), '');
  v_name text := nullif(btrim(new.main_part_name), '');
begin
  if v_part is null then
    delete from self_audit_claim_main_part where claim_id = new.id;
  else
    insert into self_audit_claim_main_part (claim_id, branch_id, part_no, part_name)
    values (new.id, new.branch_id, v_part, coalesce(v_name, (select n.part_name from self_audit_part_names n where n.part_no = v_part)))
    on conflict (claim_id) do update
      set branch_id = excluded.branch_id,
          part_no = excluded.part_no,
          part_name = coalesce(excluded.part_name, case when self_audit_claim_main_part.part_no = excluded.part_no then self_audit_claim_main_part.part_name end)
      where self_audit_claim_main_part.part_no is distinct from excluded.part_no
         or self_audit_claim_main_part.branch_id is distinct from excluded.branch_id
         or (excluded.part_name is not null and self_audit_claim_main_part.part_name is distinct from excluded.part_name);
  end if;
  return null;
end;
$$;

create or replace function public.claim_main_part_name(c public.self_audit_claims)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim(c.main_part_name), ''),
    (select cp.part_name from self_audit_claim_parts cp where cp.claim_id = c.id and cp.part_no = f.p and cp.part_name is not null limit 1),
    (select n.part_name from self_audit_part_names n where n.part_no = f.p),
    f.p
  )
  from (select nullif(btrim(regexp_replace(split_part(coalesce(nullif(c.raw_row->>'Part No', ''), c.raw_row->>'Main Part', ''), ';', 1), '^\s*#', '')), '') as p) f;
$$;

-- The lookup by part number now uses self_audit_part_names; the extra index only slowed the Part Details upload.
drop index if exists public.self_audit_claim_parts_part_no_idx;

-- Backfill (done in id ranges on the live database): one row per claim with parts.
-- insert into self_audit_claim_main_part (claim_id, branch_id, part_no, part_name) select ... from self_audit_claims ... on conflict do nothing;
-- select refresh_claim_main_part_names();
