-- Technical Inquiries:
--  * "Escalated by" is the person who submits (name and role from their account) - the role list grows accordingly.
--  * A team leader's case goes to the branch's workshop supervisor only when the branch has one; otherwise straight to
--    the technical team.
--  * The supervisor can RETURN a case to the team leader (to complete documents / diagnosis - it is not cancelled) or
--    REJECT it with a reason. A returned case can be edited by the team leader and sent to the supervisor again.
--  * Cases can be edited (the supervisor / branch admin of the branch while it is with the workshop side or open, the team
--    leader on his own case while it waits for or was returned by the supervisor, officers any time it is not finished).
--    Every edit keeps the version before it (self_audit_technical_inquiry_versions) for the technical team and officers.

alter table self_audit_technical_inquiries drop constraint self_audit_technical_inquiries_status_check;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_status_check
  check (status in ('pending_verification', 'returned', 'open', 'awaiting_workshop', 'closed', 'cancelled', 'rejected'));
alter table self_audit_technical_inquiry_comments drop constraint self_audit_technical_inquiry_comments_kind_check;
alter table self_audit_technical_inquiry_comments add constraint self_audit_technical_inquiry_comments_kind_check
  check (kind in ('comment', 'closed', 'reopened', 'cancelled', 'resubmitted', 'assigned', 'verified', 'rejected', 'returned', 'sent_to_supervisor', 'edited'));
alter table self_audit_technical_inquiries drop constraint if exists self_audit_technical_inquiries_responsible_role_check;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_responsible_role_check
  check (responsible_role in ('workshop_supervisor', 'delegated', 'team_leader', 'branch_admin', 'officer'));

create table if not exists self_audit_technical_inquiry_versions (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references self_audit_technical_inquiries (id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  edited_by uuid references self_audit_users (id) on delete set null,
  edited_by_name text,
  edited_role text,
  edited_at timestamptz not null default now(),
  unique (inquiry_id, version_no)
);
alter table self_audit_technical_inquiry_versions enable row level security;
create policy "team and officers read inquiry versions" on self_audit_technical_inquiry_versions for select using (
  (select current_user_role()::text) in ('officer', 'technical')
);

-- The technical team sees a case only once it has been verified (never while it is with the supervisor, returned or rejected).
drop policy "read technical inquiries" on self_audit_technical_inquiries;
create policy "read technical inquiries" on self_audit_technical_inquiries for select using (
  (select current_user_role()::text) = 'officer'
  or ((select current_user_role()::text) = 'technical' and status not in ('pending_verification', 'returned', 'rejected'))
  or ((select current_user_role()::text) in ('branch_admin', 'workshop_supervisor', 'team_leader')
      and branch_id = (select current_user_branch_id())
      and (select feature_enabled('technical_inquiries_branch_admins')))
);

-- Does a case submitted by this role for this branch wait for the workshop supervisor first?
create or replace function public.inquiry_needs_verification(p_role text, p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_role = 'team_leader'
     and exists (select 1 from self_audit_users u where u.role::text = 'workshop_supervisor' and u.branch_id = p_branch_id);
$$;

do $$
declare d text; n text;
begin
  -- create: verification only when the branch has a supervisor
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_technical_inquiry';
  if position('case when a.role = ''team_leader'' then ''pending_verification'' else ''open'' end, case when a.role = ''team_leader'' then null else now() end' in d) = 0 then raise exception 'create: status rule not found'; end if;
  d := replace(d, 'case when a.role = ''team_leader'' then ''pending_verification'' else ''open'' end, case when a.role = ''team_leader'' then null else now() end',
                  'case when inquiry_needs_verification(a.role, p_branch_id) then ''pending_verification'' else ''open'' end, case when inquiry_needs_verification(a.role, p_branch_id) then null else now() end');
  execute d;

  -- resubmit (a closed / cancelled case sent again): same rule
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resubmit_technical_inquiry';
  if position('when a.role = ''team_leader''' in d) = 0 then raise exception 'resubmit: rule not found'; end if;
  d := replace(d, 'when a.role = ''team_leader''', 'when inquiry_needs_verification(a.role, r.branch_id)');
  execute d;

  -- comments: a returned case is a talk inside the workshop like a case waiting for verification; rejected is final
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'technical_inquiry_comment';
  if position('if r.status = ''pending_verification'' then raise exception ''Inquiry not found.''' in d) = 0 then raise exception 'comment: technical guard not found'; end if;
  d := replace(d, 'if r.status = ''pending_verification'' then raise exception ''Inquiry not found.''', 'if r.status in (''pending_verification'', ''returned'', ''rejected'') then raise exception ''Inquiry not found.''');
  if position('if r.status in (''closed'', ''cancelled'') then' in d) = 0 then raise exception 'comment: finished list not found'; end if;
  d := replace(d, 'if r.status in (''closed'', ''cancelled'') then', 'if r.status in (''closed'', ''cancelled'', ''rejected'') then');
  if position('  if r.status = ''pending_verification'' then' in d) = 0 then raise exception 'comment: workshop talk not found'; end if;
  d := replace(d, '  if r.status = ''pending_verification'' then', '  if r.status in (''pending_verification'', ''returned'') then');
  execute d;

  -- the technical team's functions refuse cases that are not theirs yet
  for n in select unnest(array['close_technical_inquiry', 'claim_technical_inquiry']) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    if position('(''closed'', ''cancelled'', ''pending_verification'')' in d) = 0 then raise exception '% : status list not found', n; end if;
    d := replace(d, '(''closed'', ''cancelled'', ''pending_verification'')', '(''closed'', ''cancelled'', ''pending_verification'', ''returned'', ''rejected'')');
    execute d;
  end loop;

  -- cancel: a returned case can be withdrawn too
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_technical_inquiry';
  if position('(''pending_verification'', ''open'', ''awaiting_workshop'')' in d) = 0 then raise exception 'cancel: list not found'; end if;
  d := replace(d, '(''pending_verification'', ''open'', ''awaiting_workshop'')', '(''pending_verification'', ''returned'', ''open'', ''awaiting_workshop'')');
  execute d;
end $$;

-- The supervisor rejects: final, with the reason (not "cancelled" any more).
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
  if r.status not in ('pending_verification', 'returned') then raise exception 'This case is not with the workshop supervisor.'; end if;
  if v_reason = '' then raise exception 'Write the reason for rejecting the case.'; end if;
  update self_audit_technical_inquiries set status = 'rejected', updated_at = now(), waiting_since = null where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'rejected', a.user_id, a.name, a.role, v_reason);
end;
$$;

-- The supervisor returns the case to the team leader to complete documents / diagnosis.
create or replace function public.return_technical_inquiry(p_inquiry_id uuid, p_reason text)
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
    raise exception 'Only the workshop supervisor can return a case.';
  end if;
  if r.status <> 'pending_verification' then raise exception 'This case is not waiting for verification.'; end if;
  if v_reason = '' then raise exception 'Say what is missing, so the team leader can complete it.'; end if;
  update self_audit_technical_inquiries set status = 'returned', updated_at = now(), waiting_since = now() where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'returned', a.user_id, a.name, a.role, v_reason);
end;
$$;

-- The team leader (or anyone on the workshop side of the branch) sends a returned case to the supervisor again.
create or replace function public.send_inquiry_to_supervisor(p_inquiry_id uuid, p_comment text default null)
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
  if r.status <> 'returned' then raise exception 'Only a returned case can be sent to the supervisor again.'; end if;
  update self_audit_technical_inquiries set status = 'pending_verification', updated_at = now(), waiting_since = null where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'sent_to_supervisor', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_comment, '')), ''));
end;
$$;

-- Editing a case: the version before the edit is kept, the change is written in the case's log.
create or replace function public.edit_technical_inquiry(p_inquiry_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_no integer; v_snapshot jsonb;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if r.status in ('closed', 'cancelled', 'rejected') then raise exception 'A finished case cannot be edited.'; end if;
  if a.role = 'officer' then
    null;
  elsif a.role in ('workshop_supervisor', 'branch_admin') then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role = 'team_leader' then
    if r.branch_id is distinct from a.branch_id or r.created_by is distinct from a.user_id then raise exception 'Only the team leader who submitted the case can edit it.'; end if;
    if r.status not in ('pending_verification', 'returned') then raise exception 'The case is with the technical team now - ask your supervisor to edit it.'; end if;
  else
    raise exception 'Not allowed.';
  end if;

  v_snapshot := jsonb_build_object(
    'vin', r.vin, 'plate_number', r.plate_number, 'vehicle_model', r.vehicle_model, 'system', r.system, 'vehicle_location', r.vehicle_location,
    'mileage_km', r.mileage_km, 'dtc_codes', r.dtc_codes, 'software_version', r.software_version, 'occurrence', r.occurrence,
    'occurrence_keys', to_jsonb(r.occurrence_keys), 'occurrence_conditions', r.occurrence_conditions, 'parts_replaced', r.parts_replaced,
    'responsible_phone', r.responsible_phone, 'concern_first_noticed', r.concern_first_noticed, 'after_previous_repair', r.after_previous_repair,
    'previous_repair_details', r.previous_repair_details, 'fault_complaint', r.fault_complaint, 'actions_taken', r.actions_taken,
    'workshop_comments', r.workshop_comments);
  select coalesce(max(version_no), 0) + 1 into v_no from self_audit_technical_inquiry_versions where inquiry_id = r.id;
  insert into self_audit_technical_inquiry_versions (inquiry_id, version_no, snapshot, edited_by, edited_by_name, edited_role)
  values (r.id, v_no, v_snapshot, a.user_id, a.name, a.role);

  update self_audit_technical_inquiries set
    vin = coalesce(upper(btrim(p_fields->>'vin')), vin),
    plate_number = coalesce(upper(btrim(p_fields->>'plate_number')), plate_number),
    vehicle_model = coalesce(btrim(p_fields->>'vehicle_model'), vehicle_model),
    system = coalesce(p_fields->>'system', system),
    vehicle_location = coalesce(p_fields->>'vehicle_location', vehicle_location),
    mileage_km = coalesce((p_fields->>'mileage_km')::integer, mileage_km),
    dtc_codes = case when p_fields ? 'dtc_codes' then nullif(btrim(p_fields->>'dtc_codes'), '') else dtc_codes end,
    software_version = case when p_fields ? 'software_version' then nullif(btrim(p_fields->>'software_version'), '') else software_version end,
    occurrence = coalesce(p_fields->>'occurrence', occurrence),
    occurrence_conditions = case when p_fields ? 'occurrence_conditions' then nullif(btrim(p_fields->>'occurrence_conditions'), '') else occurrence_conditions end,
    parts_replaced = case when p_fields ? 'parts_replaced' then nullif(btrim(p_fields->>'parts_replaced'), '') else parts_replaced end,
    responsible_phone = case when p_fields ? 'responsible_phone' then nullif(btrim(p_fields->>'responsible_phone'), '') else responsible_phone end,
    concern_first_noticed = coalesce(nullif(btrim(p_fields->>'concern_first_noticed'), ''), concern_first_noticed),
    after_previous_repair = coalesce(p_fields->>'after_previous_repair', after_previous_repair),
    previous_repair_details = case when p_fields ? 'previous_repair_details' then nullif(btrim(p_fields->>'previous_repair_details'), '') else previous_repair_details end,
    fault_complaint = coalesce(nullif(btrim(p_fields->>'fault_complaint'), ''), fault_complaint),
    actions_taken = coalesce(nullif(btrim(p_fields->>'actions_taken'), ''), actions_taken),
    workshop_comments = case when p_fields ? 'workshop_comments' then nullif(btrim(p_fields->>'workshop_comments'), '') else workshop_comments end,
    updated_at = now()
  where id = r.id;

  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'edited', a.user_id, a.name, a.role, 'Version ' || v_no || ' saved before this edit');
end;
$$;
