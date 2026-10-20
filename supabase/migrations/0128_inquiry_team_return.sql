-- Technical Inquiries: the technical team (or an officer) can return a case to the team leader. A case returned by the
-- technical team stays visible to them, and when the team leader sends it back it goes straight to the technical team
-- (no second verification by the supervisor). The technical team can also edit a case's details while working on it.
alter table self_audit_technical_inquiries add column if not exists returned_by text check (returned_by in ('supervisor', 'technical'));

drop policy "read technical inquiries" on self_audit_technical_inquiries;
create policy "read technical inquiries" on self_audit_technical_inquiries for select using (
  (select current_user_role()::text) = 'officer'
  or ((select current_user_role()::text) = 'technical'
      and status not in ('pending_verification', 'rejected')
      and not (status = 'returned' and coalesce(returned_by, 'supervisor') = 'supervisor'))
  or ((select current_user_role()::text) in ('branch_admin', 'workshop_supervisor', 'team_leader')
      and branch_id = (select current_user_branch_id())
      and (select feature_enabled('technical_inquiries_branch_admins')))
);

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'technical_inquiry_comment';
  if position('if r.status in (''pending_verification'', ''returned'', ''rejected'') then raise exception ''Inquiry not found.''' in d) = 0 then raise exception 'comment: guard not found'; end if;
  d := replace(d, 'if r.status in (''pending_verification'', ''returned'', ''rejected'') then raise exception ''Inquiry not found.''',
    'if r.status in (''pending_verification'', ''rejected'') or (r.status = ''returned'' and coalesce(r.returned_by, ''supervisor'') = ''supervisor'') then raise exception ''Inquiry not found.''');
  execute d;
end $$;

create or replace function public.return_technical_inquiry(p_inquiry_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_reason text := btrim(coalesce(p_reason, '')); v_by text;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if v_reason = '' then raise exception 'Say what is missing, so the team leader can complete it.'; end if;
  if r.status = 'pending_verification' then
    -- the supervisor returns it before it reaches the technical team
    if a.role in ('workshop_supervisor', 'branch_admin') then
      if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
    elsif a.role <> 'officer' then
      raise exception 'Only the workshop supervisor can return a case that waits for verification.';
    end if;
    v_by := 'supervisor';
  elsif r.status in ('open', 'awaiting_workshop') then
    -- the technical team returns it to the team leader to complete documents / diagnosis
    if a.role not in ('technical', 'officer') then raise exception 'Only the technical team can return a case it is working on.'; end if;
    v_by := 'technical';
  else
    raise exception 'This case cannot be returned now.';
  end if;
  update self_audit_technical_inquiries set status = 'returned', returned_by = v_by, updated_at = now(), waiting_since = now(),
    first_response_at = case when v_by = 'technical' and first_response_at is null then now() else first_response_at end
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'returned', a.user_id, a.name, a.role, v_reason);
end;
$$;

-- Sending a returned case back: to the supervisor when the supervisor returned it, straight to the technical team when the
-- technical team did. Returns the new status.
drop function if exists public.send_inquiry_to_supervisor(uuid, text);
create or replace function public.send_inquiry_to_supervisor(p_inquiry_id uuid, p_comment text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_team boolean; v_c text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if inquiry_is_workshop(a.role) then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status <> 'returned' then raise exception 'Only a returned case can be sent again.'; end if;
  v_team := coalesce(r.returned_by, 'supervisor') = 'technical';
  update self_audit_technical_inquiries
  set status = case when v_team then 'open' else 'pending_verification' end,
      returned_by = null, updated_at = now(), waiting_since = case when v_team then now() else null end
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, case when v_team then 'resubmitted' else 'sent_to_supervisor' end, a.user_id, a.name, a.role,
          coalesce(v_c, case when v_team then 'Completed and sent back to the technical team.' else null end));
  return case when v_team then 'open' else 'pending_verification' end;
end;
$$;

-- The technical team may edit a case's details while it is with them.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'edit_technical_inquiry';
  if position('  elsif a.role = ''team_leader'' then' in d) = 0 then raise exception 'edit: team leader branch not found'; end if;
  d := replace(d, '  elsif a.role = ''team_leader'' then', '  elsif a.role = ''technical'' then
    if r.status not in (''open'', ''awaiting_workshop'', ''returned'') or (r.status = ''returned'' and coalesce(r.returned_by, ''supervisor'') = ''supervisor'') then raise exception ''This case is not with the technical team.''; end if;
  elsif a.role = ''team_leader'' then');
  execute d;
end $$;
