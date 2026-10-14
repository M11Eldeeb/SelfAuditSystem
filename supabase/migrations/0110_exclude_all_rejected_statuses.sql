-- "Rejected from chief agent" is a rejected claim like "Rejected": a cancelled claim, never on the Do not scrap or
-- scrap lists. The status filters compared against the exact text 'Rejected'; they now exclude any status that
-- contains "reject".
do $$
declare d text;
begin
  for d in
    select pg_get_functiondef(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('refresh_do_not_scrap_cache', 'scrap_closed_branch_claims')
  loop
    execute replace(d, $s$c.raw_row->>'Status' is distinct from 'Rejected'$s$, $s$coalesce(c.raw_row->>'Status', '') not ilike '%reject%'$s$);
  end loop;
end $$;
