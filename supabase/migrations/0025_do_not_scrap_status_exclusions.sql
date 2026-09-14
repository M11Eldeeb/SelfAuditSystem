-- Excludes claims the branch shouldn't be told to hold onto: a claim that's
-- Closed or Rejected is dead regardless of parts, and one Returned from
-- chief agent only counts as still-live if it has a Verification Date (no
-- verification date there means it's not actually progressing) - confirmed
-- against real data: of 6 "Returned from chief agent" claims, 4 had no
-- verification date. Both fields come from raw_row (the sheet's original
-- columns), same as isSupplierPartOverdue's reasoning
-- (src/lib/warranty-room/supplier-overdue.ts).
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
      and c.raw_row->>'Status' is distinct from 'Closed'
      and c.raw_row->>'Status' is distinct from 'Rejected'
      and not (c.raw_row->>'Status' = 'Returned from chief agent' and c.raw_row->>'Verification Date' is null)
  ), '[]'::jsonb);
end;
$$;
