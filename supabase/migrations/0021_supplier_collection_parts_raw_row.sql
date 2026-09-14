-- Supplier Parts sheet only carries one "Main Part" per claim row, but a
-- claim can have several parts (self_audit_claim_parts, from the Part
-- Details sheet). The upload now expands each claim into one collection-part
-- row per actual part, so every part reserved for the supplier is correctly
-- excluded from scrap requests - not just the sheet's own main part.
-- quantity carries that per-part quantity; raw_row keeps every original
-- column from the uploaded sheet (same pattern as self_audit_claims.raw_row)
-- so the branch's downloaded Excel can show the sheet exactly as uploaded.
alter table self_audit_supplier_collection_parts
  add column quantity numeric,
  add column raw_row jsonb;
