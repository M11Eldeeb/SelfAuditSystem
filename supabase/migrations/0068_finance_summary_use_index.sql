-- The planner can't estimate how selective the JSON status filter is (it
-- guesses ~35k rows when it's ~2.7k), so it ignored
-- self_audit_claims_finance_open_idx and seq-scanned every claim: ~13s,
-- past the 8s statement timeout. Turning seq scans off inside just this
-- function makes it use the partial index: ~0.8s.
alter function public.get_finance_summary() set enable_seqscan = off;
