-- The technical team does not edit a case's details (they reply, return or close it). Removes the "technical" branch that
-- 0128 added to edit_technical_inquiry: only the branch's supervisor / admin, the team leader on his own case, and
-- officers can edit.
do $$
declare d text; v_old text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'edit_technical_inquiry';
  v_old := '  elsif a.role = ''technical'' then
    if r.status not in (''open'', ''awaiting_workshop'', ''returned'') or (r.status = ''returned'' and coalesce(r.returned_by, ''supervisor'') = ''supervisor'') then raise exception ''This case is not with the technical team.''; end if;
';
  if position(v_old in d) = 0 then raise exception 'edit: technical branch not found'; end if;
  d := replace(d, v_old, '');
  execute d;
end $$;
