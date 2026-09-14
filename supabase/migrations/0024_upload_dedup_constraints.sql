-- Parts Already Scraped and Supplier Parts both used plain insert() with no
-- uniqueness at all, so re-uploading the same (or an overlapping) file
-- created true duplicate rows instead of updating what was already on file.
-- Claims/claim parts/scrap requests don't have this problem - they already
-- upsert on a natural key. These add the same guarantee: re-uploading
-- merges into what's already there instead of duplicating it.
--
-- Plain (non-partial) unique indexes, not "where claim_id is not null" -
-- Postgres can't infer a partial index for upsert()'s ON CONFLICT target
-- unless the WHERE clause is also specified, which supabase-js's upsert()
-- has no way to pass. NULL never conflicts with NULL in a unique index
-- though, so a plain index gives the same effect: rows with a null claim_id
-- simply aren't deduped by the claim_id index (they fall through to the
-- second index instead).
--
-- The second (fallback, for rows that couldn't be matched to a claim) key
-- is (work_order_no, part_no), not (external_request_no, part_no) as
-- originally tried - external_request_no ("Request" in the sheet) turned
-- out to be a shared batch/request id, not unique per part (confirmed live:
-- one real request number covered 24 unrelated claims), so it can't
-- identify a single record on its own.
create unique index self_audit_scrapped_parts_claim_part_uidx
  on self_audit_scrapped_parts (claim_id, part_no);
create unique index self_audit_scrapped_parts_unmatched_uidx
  on self_audit_scrapped_parts (work_order_no, part_no);

-- One reservation per part per claim within a collection; unmatched rows
-- fall back to (collection_id, work_order_no, part_no).
create unique index self_audit_supplier_collection_parts_claim_part_uidx
  on self_audit_supplier_collection_parts (collection_id, claim_id, part_no);
create unique index self_audit_supplier_collection_parts_unmatched_uidx
  on self_audit_supplier_collection_parts (collection_id, work_order_no, part_no);
