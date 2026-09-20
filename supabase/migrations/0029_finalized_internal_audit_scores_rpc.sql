-- Standings (self_audit_standings computation) now blends finalized internal
-- audit scores into each branch's overall average alongside self-audit
-- results, for every branch, viewed by anyone (officer or branch admin).
-- self_audit_internal_audits' own RLS only lets a branch admin read their
-- own branch's rows (it also carries closing_statement/recommendations/
-- auditor and manager names - real audit-report content that shouldn't be
-- broadcast to every other branch), so a plain table select can't serve this
-- for branch admins. This RPC returns only the two columns standings needs,
-- for every finalized internal audit regardless of caller - narrower than
-- widening the table's own RLS.
create or replace function public.get_finalized_internal_audit_scores()
returns table (branch_id uuid, score_pct numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select branch_id, score_pct
  from self_audit_internal_audits
  where status = 'finalized'
    and branch_id is not null
    and score_pct is not null;
$$;
