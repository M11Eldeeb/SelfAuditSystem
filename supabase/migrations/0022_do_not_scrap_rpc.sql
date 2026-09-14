-- Computing the do-not-scrap list in JS (fetch every claim for a branch,
-- fetch every scrap_request/scrapped_part row in the whole system paginated
-- 1000 rows at a time, subtract in JS) took 50+ seconds once
-- self_audit_scrapped_parts passed ~30k rows - dozens of sequential page
-- round trips. A single indexed query does the same exclusion server-side in
-- one round trip. Returned as a single jsonb value (not a table/setof) so
-- PostgREST's row-count cap never truncates it, matching the reasoning in
-- src/lib/supabase/paginate.ts but avoiding pagination entirely instead of
-- working around it.
--
-- security definer bypasses RLS, so branch scoping is enforced here instead:
-- an officer may query any branch, a branch admin only their own.
create or replace function public.get_do_not_scrap_claims(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user_role() = 'branch_admin' and p_branch_id is distinct from current_user_branch_id() then
    raise exception 'You can only view your own branch.';
  elsif current_user_role() not in ('officer', 'branch_admin') then
    raise exception 'Not authorized.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_number', c.claim_number,
      'work_order_no', c.work_order_no,
      'vin', c.vin,
      'main_part_name', c.main_part_name,
      'creation_date', c.creation_date
    ) order by c.creation_date desc)
    from self_audit_claims c
    where c.branch_id = p_branch_id
      and c.has_parts = true
      and not exists (select 1 from self_audit_scrap_requests sr where sr.claim_id = c.id)
      and not exists (select 1 from self_audit_scrapped_parts sp where sp.claim_id = c.id)
  ), '[]'::jsonb);
end;
$$;
