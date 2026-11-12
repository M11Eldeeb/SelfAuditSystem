-- Query page: find a job / vehicle in every source without reading whole tables.
create index if not exists self_audit_invoicing_detail_wip_idx on self_audit_invoicing_detail (wip);
create index if not exists self_audit_invoicing_detail_vin_idx on self_audit_invoicing_detail (vin);
create index if not exists self_audit_complaints_vin_idx on self_audit_complaints (vin);
-- The WIP number of a claim's work order ("RSS-37645-1" -> "37645"), to find a WIP's claims in any branch.
alter table self_audit_claim_settlement add column if not exists wip_digits text generated always as (nullif(ltrim(split_part(work_order_no, '-', 2), '0'), '')) stored;
create index if not exists self_audit_claim_settlement_wip_idx on self_audit_claim_settlement (wip_digits, branch_id);
