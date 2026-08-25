-- Branch admins can now see every branch's name and finalized score, to power
-- the cross-branch standings/podium view on their dashboard. This intentionally
-- widens visibility beyond a branch's own data - only branch names and
-- finalized score_pct are exposed this way, never claims, answers, or photos.

create policy "branch admins read all branches" on branches for select
  using (current_user_role() = 'branch_admin');

create policy "branch admins read all audit_results" on audit_results for select
  using (current_user_role() = 'branch_admin');
