-- The stored-hash column on the claims table (0100) and everything that existed only for it are replaced by
-- self_audit_claim_hashes (0106): fewer and narrower writes on the 200 MB claims table.
drop index if exists public.claims_manifest_idx;
drop function if exists public.claims_upload_manifest(uuid, text, integer);
drop function if exists public.claims_match_hashes(jsonb);
drop function if exists public.claims_fingerprints_page(bigint, integer);
alter table public.self_audit_claims drop column if exists source_hash;
