-- Superseded by run_generate_scrap_requests_all(), run on a schedule via
-- pg_cron instead of paged calls from the browser - see migration 0041.
drop function if exists public.generate_scrap_requests_chunk(uuid, integer);
