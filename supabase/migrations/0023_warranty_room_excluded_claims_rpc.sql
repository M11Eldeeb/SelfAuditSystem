-- Same problem as get_do_not_scrap_claims (migration 0022): computing this
-- union in JS via selectAllRows paginated 1000 rows at a time against
-- self_audit_scrapped_parts (30,000+ rows) takes tens of seconds. Cycle
-- generation and internal-audit sampling call this on every run, so it's
-- worse here - a single indexed query replaces it. officer-only, matching
-- the two callers (generateCycle, sampleEligibleClaims/startInternalAudit).
create or replace function public.get_warranty_room_excluded_claim_ids()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() <> 'officer' then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(distinct claim_id) from (
      select claim_id from self_audit_scrap_requests
      union
      select claim_id from self_audit_scrapped_parts where claim_id is not null
      union
      select scp.claim_id
      from self_audit_supplier_collection_parts scp
      join self_audit_supplier_collections sc on sc.id = scp.collection_id
      where sc.status = 'handed_over' and scp.claim_id is not null
    ) excluded(claim_id)
  ), '[]'::jsonb);
end;
$$;
