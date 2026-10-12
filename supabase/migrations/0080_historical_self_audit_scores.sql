-- Historical (pre-website) self-audit scores, readable by every signed-in user
-- so the standings can count them: the standings compare ALL branches, but
-- self_audit_historical_audits' RLS lets a branch admin read only their own
-- branch's rows. Same shape and approach as get_historical_internal_audit_scores;
-- only (branch_id, score_pct) is exposed, never the PDFs or notes.
create or replace function public.get_historical_self_audit_scores()
returns table (branch_id uuid, score_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  select branch_id, score_pct
  from self_audit_historical_audits
  where audit_type = 'self_audit';
$$;

revoke all on function public.get_historical_self_audit_scores() from public, anon;
grant execute on function public.get_historical_self_audit_scores() to authenticated, service_role;
