-- The Trends and KPI dashboards read thousands of claims at once, so they cannot work the main part out per claim
-- from the wide raw_row (claim_main_part_name, 0131, reads raw_row - about 8 s for 12,000 claims). This keeps the main
-- part in a narrow table instead, one row per claim with parts:
--   * the part number comes from the claim itself (trigger on the claims table - only claims an upload actually
--     changes are touched, so the incremental upload stays as fast as before);
--   * the name comes from the Part Details names (self_audit_part_names), refreshed once at the end of an upload
--     with refresh_claim_main_part_names() - not per Part Details row, which would slow that step down.
create table if not exists public.self_audit_part_names (
  part_no text primary key,
  part_name text not null
);

create table if not exists public.self_audit_claim_main_part (
  claim_id uuid primary key references public.self_audit_claims (id) on delete cascade,
  branch_id uuid not null,
  part_no text not null,
  part_name text
);
create index if not exists self_audit_claim_main_part_part_no_idx on public.self_audit_claim_main_part (part_no);
create index if not exists self_audit_claim_main_part_branch_idx on public.self_audit_claim_main_part (branch_id);

alter table public.self_audit_part_names enable row level security;
alter table public.self_audit_claim_main_part enable row level security;
-- Same rule as the claims themselves: officers all, a branch admin their own branch.
create policy "read part names" on public.self_audit_part_names for select to authenticated using (true);
create policy "read claim main part" on public.self_audit_claim_main_part for select to authenticated
  using ((select current_user_role()) = 'officer' or branch_id = (select current_user_branch_id()));

create or replace function public.sync_claim_main_part()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part text := nullif(btrim(regexp_replace(split_part(coalesce(new.raw_row->>'Part No', ''), ';', 1), '^\s*#', '')), '');
begin
  if v_part is null then
    delete from self_audit_claim_main_part where claim_id = new.id;
  else
    insert into self_audit_claim_main_part (claim_id, branch_id, part_no, part_name)
    values (new.id, new.branch_id, v_part, (select n.part_name from self_audit_part_names n where n.part_no = v_part))
    on conflict (claim_id) do update
      set branch_id = excluded.branch_id,
          part_no = excluded.part_no,
          part_name = coalesce(excluded.part_name, case when self_audit_claim_main_part.part_no = excluded.part_no then self_audit_claim_main_part.part_name end)
      where self_audit_claim_main_part.part_no is distinct from excluded.part_no
         or self_audit_claim_main_part.branch_id is distinct from excluded.branch_id;
  end if;
  return null;
end;
$$;

drop trigger if exists claims_sync_main_part on public.self_audit_claims;
create trigger claims_sync_main_part after insert or update on public.self_audit_claims
  for each row execute function public.sync_claim_main_part();

-- Brings the names up to date after Part Details were uploaded. Set-based, run once per upload.
create or replace function public.refresh_claim_main_part_names()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  if current_user_role() is distinct from 'officer' and auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'Only officers can refresh the main part names';
  end if;
  insert into self_audit_part_names (part_no, part_name)
  select distinct on (part_no) part_no, part_name from self_audit_claim_parts where part_name is not null order by part_no, created_at desc
  on conflict (part_no) do update set part_name = excluded.part_name where self_audit_part_names.part_name is distinct from excluded.part_name;

  update self_audit_claim_main_part m set part_name = n.part_name
  from self_audit_part_names n
  where n.part_no = m.part_no and m.part_name is distinct from n.part_name;
end;
$$;
revoke all on function public.refresh_claim_main_part_names() from public, anon;
grant execute on function public.refresh_claim_main_part_names() to authenticated, service_role;

-- Backfill (run in id ranges on the live database because the claims table is large).
insert into self_audit_claim_main_part (claim_id, branch_id, part_no)
select c.id, c.branch_id, nullif(btrim(regexp_replace(split_part(coalesce(c.raw_row->>'Part No', ''), ';', 1), '^\s*#', '')), '')
from self_audit_claims c
where nullif(btrim(regexp_replace(split_part(coalesce(c.raw_row->>'Part No', ''), ';', 1), '^\s*#', '')), '') is not null
on conflict (claim_id) do nothing;
select refresh_claim_main_part_names();
