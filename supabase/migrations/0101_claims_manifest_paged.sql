-- The first version of claims_upload_manifest read a whole branch (17,000+ claims) in one statement; on a cold cache
-- that took ~11 s, longer than the 8 s statement timeout an officer's request gets. Now it answers one page at a time
-- (ordered by claim_number, keyset-paged) and a covering index lets Postgres answer from the index alone.

create index if not exists claims_manifest_idx on public.self_audit_claims (branch_id, claim_number) include (id, source_hash);

drop function if exists public.claims_upload_manifest(uuid);

create or replace function public.claims_upload_manifest(p_branch_id uuid, p_after text default null, p_limit integer default 4000)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_array(p.id, p.claim_number, p.source_hash) order by p.claim_number), '[]'::jsonb)
  from (
    select c.id, c.claim_number, c.source_hash
    from self_audit_claims c
    where c.branch_id = p_branch_id
      and (p_after is null or c.claim_number > p_after)
    order by c.claim_number
    limit least(greatest(p_limit, 1), 10000)
  ) p;
$$;
