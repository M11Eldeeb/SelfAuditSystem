-- Warranty Room search: find a claim by work order or VIN without reading the whole claims table.
create index if not exists self_audit_claims_work_order_idx on self_audit_claims (work_order_no);
create index if not exists self_audit_claims_vin_idx on self_audit_claims (vin);
