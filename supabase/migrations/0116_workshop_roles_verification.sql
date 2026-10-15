-- Technical Inquiries: workshop supervisor and team leader accounts, and the verification step.
--   * two new account types (user_role values added in 0116a): "workshop_supervisor" and "team_leader", both tied to a branch
--   * the workshop side of a case is now any of branch_admin / workshop_supervisor / team_leader
--   * a case submitted by a TEAM LEADER is not sent to the technical team: it waits as "pending_verification" until the
--     workshop supervisor of that branch (or the branch admin, or an officer) verifies it; the supervisor can also reject it
--     with a reason. Only then does it reach the technical team, who cannot see it before.
-- (The user_role values were added by the separate migration "workshop_roles_enum", a new enum value cannot be used in the
-- transaction that adds it.)

alter table self_audit_users drop constraint branch_admin_requires_branch;
alter table self_audit_users add constraint branch_admin_requires_branch check (
  (role::text in ('branch_admin', 'workshop_supervisor', 'team_leader') and branch_id is not null) or role::text in ('officer', 'finance', 'technical')
);

alter table self_audit_technical_inquiries drop constraint self_audit_technical_inquiries_status_check;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_status_check
  check (status in ('pending_verification', 'open', 'awaiting_workshop', 'closed', 'cancelled'));
alter table self_audit_technical_inquiries
  add column verified_by uuid references self_audit_users (id) on delete set null,
  add column verified_by_name text,
  add column verified_at timestamptz;
alter table self_audit_technical_inquiry_comments drop constraint self_audit_technical_inquiry_comments_kind_check;
alter table self_audit_technical_inquiry_comments add constraint self_audit_technical_inquiry_comments_kind_check
  check (kind in ('comment', 'closed', 'reopened', 'cancelled', 'resubmitted', 'assigned', 'verified', 'rejected'));

create or replace function public.inquiry_is_workshop(p_role text)
returns boolean
language sql immutable
as $$ select p_role in ('branch_admin', 'workshop_supervisor', 'team_leader') $$;

-- Reading: the workshop side sees its own branch's cases (once the feature is unlocked); the technical team never sees a
-- case that is still waiting for verification.
drop policy "read technical inquiries" on self_audit_technical_inquiries;
create policy "read technical inquiries" on self_audit_technical_inquiries for select using (
  (select current_user_role()::text) = 'officer'
  or ((select current_user_role()::text) = 'technical' and status <> 'pending_verification')
  or ((select current_user_role()::text) in ('branch_admin', 'workshop_supervisor', 'team_leader')
      and branch_id = (select current_user_branch_id())
      and (select feature_enabled('technical_inquiries_branch_admins')))
);

-- ---- submitting: any workshop role; a team leader's case waits for verification ------------------------------------------
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_technical_inquiry';
  if position('if a.role = ''branch_admin'' then' in d) = 0 then raise exception 'create: role check not found'; end if;
  d := replace(d, 'if a.role = ''branch_admin'' then', 'if inquiry_is_workshop(a.role) then');
  if position('submit_reasons, created_by, created_by_name, assigned_to, assigned_to_name)' in d) = 0 then raise exception 'create: columns not found'; end if;
  d := replace(d, 'submit_reasons, created_by, created_by_name, assigned_to, assigned_to_name)', 'submit_reasons, created_by, created_by_name, assigned_to, assigned_to_name, status, waiting_since)');
  if position('v_reasons, a.user_id, a.name, v_tech, v_tech_name)' in d) = 0 then raise exception 'create: values not found'; end if;
  d := replace(d, 'v_reasons, a.user_id, a.name, v_tech, v_tech_name)', 'v_reasons, a.user_id, a.name, v_tech, v_tech_name, case when a.role = ''team_leader'' then ''pending_verification'' else ''open'' end, case when a.role = ''team_leader'' then null else now() end)');
  execute d;
end $$;

-- ---- comments ---------------------------------------------------------------------------------------------------------------
create or replace function public.technical_inquiry_comment(p_id uuid, p_inquiry_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb, p_internal boolean default false)
returns text
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_new text;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if inquiry_is_workshop(a.role) then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
    if p_internal then raise exception 'Not allowed.'; end if;
  elsif a.role = 'technical' then
    if r.status = 'pending_verification' then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status in ('closed', 'cancelled') then raise exception 'This inquiry is % - it cannot take new comments.', r.status; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Write your comment.'; end if;

  if r.status = 'pending_verification' then
    -- the team leader and the supervisor talk it over before it is verified: nothing changes about whose turn it is
    if p_internal then raise exception 'Internal notes are for cases the technical team can see.'; end if;
    insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body)
    values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body));
    perform add_inquiry_attachments(r.id, p_id, a.user_id, p_attachments);
    return r.status;
  end if;

  if p_internal then
    if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then raise exception 'Internal notes cannot have attachments.'; end if;
    insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body, internal)
    values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body), true);
    return r.status;
  end if;

  v_new := case when inquiry_is_workshop(a.role) then 'open' else 'awaiting_workshop' end;
  update self_audit_technical_inquiries
  set status = v_new, updated_at = now(), waiting_since = now(),
      first_response_at = case when not inquiry_is_workshop(a.role) and first_response_at is null then now() else first_response_at end
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body)
  values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body));
  perform add_inquiry_attachments(r.id, p_id, a.user_id, p_attachments);
  return v_new;
end;
$$;

-- ---- cancel / resubmit --------------------------------------------------------------------------------------------------------
create or replace function public.cancel_technical_inquiry(p_inquiry_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if inquiry_is_workshop(a.role) then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status not in ('pending_verification', 'open', 'awaiting_workshop') then raise exception 'Only an open inquiry can be cancelled.'; end if;
  update self_audit_technical_inquiries set status = 'cancelled', updated_at = now(), waiting_since = null where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'cancelled', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

create or replace function public.resubmit_technical_inquiry(p_inquiry_id uuid, p_comment text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_c text := btrim(coalesce(p_comment, ''));
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if inquiry_is_workshop(a.role) then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status not in ('closed', 'cancelled') then raise exception 'Only a closed or cancelled inquiry can be resubmitted.'; end if;
  if v_c = '' then raise exception 'Say what has changed or why you are sending it again.'; end if;
  -- a team leader's resubmission goes to the supervisor first, like a new case
  update self_audit_technical_inquiries
  set status = case when a.role = 'team_leader' then 'pending_verification' else 'open' end,
      closed_by = null, closed_by_name = null, closed_at = null, verified_by = null, verified_by_name = null, verified_at = null,
      updated_at = now(), waiting_since = case when a.role = 'team_leader' then null else now() end
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'resubmitted', a.user_id, a.name, a.role, v_c);
end;
$$;

-- ---- the verification -----------------------------------------------------------------------------------------------------------
create or replace function public.verify_technical_inquiry(p_inquiry_id uuid, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role in ('workshop_supervisor', 'branch_admin') then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Only the workshop supervisor can verify a case.';
  end if;
  if r.status <> 'pending_verification' then raise exception 'This case is not waiting for verification.'; end if;
  update self_audit_technical_inquiries
  set status = 'open', verified_by = a.user_id, verified_by_name = a.name, verified_at = now(), updated_at = now(), waiting_since = now()
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'verified', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_comment, '')), ''));
end;
$$;

create or replace function public.reject_technical_inquiry(p_inquiry_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role in ('workshop_supervisor', 'branch_admin') then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Only the workshop supervisor can reject a case.';
  end if;
  if r.status <> 'pending_verification' then raise exception 'This case is not waiting for verification.'; end if;
  if v_reason = '' then raise exception 'Say why the case is rejected, so the team leader can fix it.'; end if;
  update self_audit_technical_inquiries set status = 'cancelled', updated_at = now(), waiting_since = null where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'rejected', a.user_id, a.name, a.role, v_reason);
end;
$$;

-- ---- the technical team's functions refuse a case that is still waiting for verification -------------------------------------------
do $$
declare d text; n text;
begin
  for n in select unnest(array['close_technical_inquiry', 'claim_technical_inquiry']) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    if position('(''closed'', ''cancelled'')' in d) = 0 then raise exception '% : status list not found', n; end if;
    d := replace(d, '(''closed'', ''cancelled'')', '(''closed'', ''cancelled'', ''pending_verification'')');
    execute d;
  end loop;
end $$;

revoke all on function public.verify_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.reject_technical_inquiry(uuid, text) from public, anon;
grant execute on function public.verify_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.reject_technical_inquiry(uuid, text) to authenticated;
