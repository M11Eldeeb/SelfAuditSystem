-- Technical Inquiries, the complete version: more fault details, priority, system, an assigned technician with
-- per-branch routing, internal notes, response timing, cancel / resubmit, and the workshop's extra contacts.
-- (The tables were empty when this ran, so columns could be added as required.)

-- ---- statuses and kinds ----------------------------------------------------------------------------------------
alter table self_audit_technical_inquiries drop constraint self_audit_technical_inquiries_status_check;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_status_check
  check (status in ('open', 'awaiting_workshop', 'closed', 'cancelled'));
alter table self_audit_technical_inquiry_comments drop constraint self_audit_technical_inquiry_comments_kind_check;
alter table self_audit_technical_inquiry_comments add constraint self_audit_technical_inquiry_comments_kind_check
  check (kind in ('comment', 'closed', 'reopened', 'cancelled', 'resubmitted', 'assigned'));

-- ---- the fault details a technician asks for first -----------------------------------------------------------------
alter table self_audit_technical_inquiries
  add column system text not null default 'other'
    check (system in ('engine', 'transmission', 'electrical', 'adas', 'infotainment', 'hvac', 'body', 'chassis', 'hybrid_ev', 'other')),
  add column priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  add column mileage_km integer check (mileage_km is null or mileage_km between 0 and 2000000),
  add column dtc_codes text check (dtc_codes is null or char_length(dtc_codes) <= 500),
  add column software_version text check (software_version is null or char_length(software_version) <= 120),
  add column occurrence text check (occurrence is null or occurrence in ('constant', 'intermittent')),
  add column occurrence_conditions text check (occurrence_conditions is null or char_length(occurrence_conditions) <= 1000),
  add column parts_replaced text check (parts_replaced is null or char_length(parts_replaced) <= 1000),
  add column assigned_to uuid references self_audit_users (id) on delete set null,
  add column assigned_to_name text,
  -- since when the case has been waiting for someone (null once closed or cancelled)
  add column waiting_since timestamptz default now(),
  add column first_response_at timestamptz;
alter table self_audit_technical_inquiries alter column system drop default;

-- an internal note is seen by the technical team and officers only
alter table self_audit_technical_inquiry_comments add column internal boolean not null default false;

-- ---- who handles which branch ---------------------------------------------------------------------------------------
create table self_audit_inquiry_routing (
  branch_id uuid primary key references self_audit_branches (id) on delete cascade,
  technician_id uuid references self_audit_users (id) on delete set null
);
alter table self_audit_inquiry_routing enable row level security;
create policy "officers and the technical team read the routing" on self_audit_inquiry_routing for select
  using ((select current_user_role()::text) in ('officer', 'technical'));
create policy "officers manage the routing" on self_audit_inquiry_routing for all
  using ((select current_user_role()::text) = 'officer') with check ((select current_user_role()::text) = 'officer');

-- ---- more branch contacts: the workshop supervisor and team leader are copied with the service manager ---------------
alter table self_audit_branch_contacts drop constraint self_audit_branch_contacts_role_check;
alter table self_audit_branch_contacts add constraint self_audit_branch_contacts_role_check
  check (role in ('service_manager', 'workshop_supervisor', 'workshop_team_leader'));

-- ---- the two switches for the inquiry e-mails (off until you turn them on) ------------------------------------------------
insert into self_audit_mail_settings (key) values ('inquiry_mails_technical'), ('inquiry_mails_workshop');

-- ---- reading: internal notes (and their files) are hidden from the workshop ------------------------------------------------
drop policy "read technical inquiry comments" on self_audit_technical_inquiry_comments;
create policy "read technical inquiry comments" on self_audit_technical_inquiry_comments for select using (
  exists (select 1 from self_audit_technical_inquiries i where i.id = inquiry_id)
  and (not internal or (select current_user_role()::text) in ('officer', 'technical'))
);
drop policy "read technical inquiry attachments" on self_audit_technical_inquiry_attachments;
create policy "read technical inquiry attachments" on self_audit_technical_inquiry_attachments for select using (
  exists (select 1 from self_audit_technical_inquiries i where i.id = inquiry_id)
);

-- ---- the functions ----------------------------------------------------------------------------------------------------------
drop function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, boolean, jsonb);
drop function public.technical_inquiry_comment(uuid, uuid, text, jsonb);

create or replace function public.create_technical_inquiry(
  p_id uuid, p_branch_id uuid, p_work_order text, p_vin text, p_model text, p_system text, p_priority text,
  p_mileage integer, p_dtc text, p_software text, p_occurrence text, p_conditions text, p_parts text,
  p_fault text, p_actions text, p_comments text, p_terms_confirmed boolean, p_attachments jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare a record; v_no bigint; v_set uuid; v_tech uuid; v_tech_name text;
begin
  select * into a from inquiry_actor();
  if a.user_id is null then raise exception 'Please sign in again.'; end if;
  if a.role = 'branch_admin' then
    if p_branch_id is distinct from a.branch_id then raise exception 'You can only submit for your own branch.'; end if;
    if not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Technical Inquiries is coming soon for branch admins.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'You cannot submit a technical inquiry.';
  end if;
  if p_terms_confirmed is not true then raise exception 'Confirm all the terms before submitting.'; end if;
  select id into v_set from self_audit_inquiry_term_sets order by created_at desc limit 1;

  -- the technician who looks after this branch
  select r.technician_id, coalesce(nullif(btrim(u.full_name), ''), u.email) into v_tech, v_tech_name
  from self_audit_inquiry_routing r join self_audit_users u on u.id = r.technician_id
  where r.branch_id = p_branch_id;

  insert into self_audit_technical_inquiries
    (id, branch_id, work_order_no, vin, vehicle_model, system, priority, mileage_km, dtc_codes, software_version, occurrence,
     occurrence_conditions, parts_replaced, fault_complaint, actions_taken, workshop_comments, terms_set_id, created_by, created_by_name,
     assigned_to, assigned_to_name)
  values
    (p_id, p_branch_id, upper(btrim(p_work_order)), upper(btrim(p_vin)), btrim(p_model), p_system, coalesce(p_priority, 'normal'), p_mileage,
     nullif(btrim(coalesce(p_dtc, '')), ''), nullif(btrim(coalesce(p_software, '')), ''), nullif(p_occurrence, ''),
     nullif(btrim(coalesce(p_conditions, '')), ''), nullif(btrim(coalesce(p_parts, '')), ''), btrim(p_fault), btrim(p_actions),
     nullif(btrim(coalesce(p_comments, '')), ''), v_set, a.user_id, a.name, v_tech, v_tech_name)
  returning inquiry_no into v_no;
  perform add_inquiry_attachments(p_id, null, a.user_id, p_attachments);
  return v_no;
end;
$$;

create or replace function public.technical_inquiry_comment(p_id uuid, p_inquiry_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb, p_internal boolean default false)
returns text
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_new text;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role = 'branch_admin' then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
    if p_internal then raise exception 'Not allowed.'; end if;
  elsif a.role not in ('officer', 'technical') then
    raise exception 'Not allowed.';
  end if;
  if r.status in ('closed', 'cancelled') then raise exception 'This inquiry is % - it cannot take new comments.', r.status; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Write your comment.'; end if;

  if p_internal then
    -- an internal note: text only (the case's Drive folder is open to the workshop), no status change, no timer change
    if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then raise exception 'Internal notes cannot have attachments.'; end if;
    insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body, internal)
    values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body), true);
    return r.status;
  end if;

  v_new := case when a.role = 'branch_admin' then 'open' else 'awaiting_workshop' end;
  update self_audit_technical_inquiries
  set status = v_new, updated_at = now(), waiting_since = now(),
      first_response_at = case when a.role <> 'branch_admin' and first_response_at is null then now() else first_response_at end
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (id, inquiry_id, kind, author_id, author_name, author_role, body)
  values (p_id, r.id, 'comment', a.user_id, a.name, a.role, btrim(p_body));
  perform add_inquiry_attachments(r.id, p_id, a.user_id, p_attachments);
  return v_new;
end;
$$;

create or replace function public.close_technical_inquiry(p_inquiry_id uuid, p_resolution text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_res text := btrim(coalesce(p_resolution, ''));
begin
  select * into a from inquiry_actor();
  if a.role not in ('officer', 'technical') then raise exception 'Only the technical team can close an inquiry.'; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if r.status in ('closed', 'cancelled') then raise exception 'This inquiry is already %.', r.status; end if;
  if v_res = '' then raise exception 'Write a short summary of the solution before closing.'; end if;

  update self_audit_technical_inquiries
  set status = 'closed', resolution = v_res, closed_by = a.user_id, closed_by_name = a.name, closed_at = now(), updated_at = now(), waiting_since = null,
      first_response_at = coalesce(first_response_at, now())
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'closed', a.user_id, a.name, a.role, v_res);
end;
$$;

create or replace function public.reopen_technical_inquiry(p_inquiry_id uuid, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  if a.role not in ('officer', 'technical') then raise exception 'Only the technical team can reopen an inquiry.'; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if r.status <> 'closed' then raise exception 'This inquiry is not closed.'; end if;
  update self_audit_technical_inquiries
  set status = 'awaiting_workshop', closed_by = null, closed_by_name = null, closed_at = null, updated_at = now(), waiting_since = now()
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'reopened', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_comment, '')), ''));
end;
$$;

-- The workshop withdraws a case that is still open.
create or replace function public.cancel_technical_inquiry(p_inquiry_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role = 'branch_admin' then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status not in ('open', 'awaiting_workshop') then raise exception 'Only an open inquiry can be cancelled.'; end if;
  update self_audit_technical_inquiries set status = 'cancelled', updated_at = now(), waiting_since = null where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'cancelled', a.user_id, a.name, a.role, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- The workshop sends a closed or cancelled case back to the technical team (the problem came back).
create or replace function public.resubmit_technical_inquiry(p_inquiry_id uuid, p_comment text)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_c text := btrim(coalesce(p_comment, ''));
begin
  select * into a from inquiry_actor();
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  if a.role = 'branch_admin' then
    if r.branch_id is distinct from a.branch_id or not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Inquiry not found.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'Not allowed.';
  end if;
  if r.status not in ('closed', 'cancelled') then raise exception 'Only a closed or cancelled inquiry can be resubmitted.'; end if;
  if v_c = '' then raise exception 'Say what has changed or why you are sending it again.'; end if;
  update self_audit_technical_inquiries
  set status = 'open', closed_by = null, closed_by_name = null, closed_at = null, updated_at = now(), waiting_since = now()
  where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'resubmitted', a.user_id, a.name, a.role, v_c);
end;
$$;

create or replace function public.assign_technical_inquiry(p_inquiry_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record; v_name text;
begin
  select * into a from inquiry_actor();
  if a.role not in ('officer', 'technical') then raise exception 'Only the technical team can assign a case.'; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null then raise exception 'Inquiry not found.'; end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from self_audit_users where id = p_user_id and role::text = 'technical';
  if v_name is null then raise exception 'Choose someone from the technical team.'; end if;
  update self_audit_technical_inquiries set assigned_to = p_user_id, assigned_to_name = v_name, updated_at = now() where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'assigned', a.user_id, a.name, a.role, 'Assigned to ' || v_name);
end;
$$;

revoke all on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
revoke all on function public.technical_inquiry_comment(uuid, uuid, text, jsonb, boolean) from public, anon;
revoke all on function public.close_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.reopen_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.cancel_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.resubmit_technical_inquiry(uuid, text) from public, anon;
revoke all on function public.assign_technical_inquiry(uuid, uuid) from public, anon;
grant execute on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.technical_inquiry_comment(uuid, uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.close_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.reopen_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.cancel_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.resubmit_technical_inquiry(uuid, text) to authenticated;
grant execute on function public.assign_technical_inquiry(uuid, uuid) to authenticated;
