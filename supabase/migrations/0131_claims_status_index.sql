-- Reconciliation -> Rejected claims looks claims up by the export's Status ("Rejected..."): without an index that is a scan
-- of every claim's raw row and times out. text_pattern_ops lets `like 'Rejected%'` use it.
create index if not exists self_audit_claims_status_idx on self_audit_claims ((raw_row->>'Status') text_pattern_ops);
analyze self_audit_claims;
