-- Technical Inquiries: the technical team's validation requirements for an escalated case, built into the form and
-- enforced by the database:
--   * escalated by the workshop supervisor or a delegated responsible (who has the full picture and talks to the technical team)
--   * vehicle data: VIN, work order (WIP), mileage and plate number
--   * the customer's concern with clear media (photo or video)
--   * the conditions of the concern: permanent, intermittent or a specific condition
--   * when it first appeared (from the customer interview) and whether it follows a previous repair
--   * the full vehicle history (service / repair history) attached
--   * the workshop effort, written accurately and in sequence, supported with media
-- (The inquiries table was empty when this ran, so the new columns could be required.)

-- ---- the new fields ------------------------------------------------------------------------------------------------------
alter table self_audit_technical_inquiries
  add column plate_number text not null check (char_length(btrim(plate_number)) between 2 and 20),
  add column responsible_name text not null check (char_length(btrim(responsible_name)) between 2 and 120),
  add column responsible_role text not null check (responsible_role in ('workshop_supervisor', 'delegated')),
  add column responsible_phone text check (responsible_phone is null or char_length(responsible_phone) <= 40),
  add column concern_first_noticed text not null check (char_length(btrim(concern_first_noticed)) between 1 and 300),
  add column after_previous_repair text not null check (after_previous_repair in ('yes', 'no', 'unknown')),
  add column previous_repair_details text check (previous_repair_details is null or char_length(previous_repair_details) <= 1000),
  add column workshop_steps text[] not null check (cardinality(workshop_steps) between 1 and 30);

-- mileage and how often are now required; "constant" becomes "permanent" and a specific condition is a third choice
alter table self_audit_technical_inquiries alter column mileage_km set not null;
alter table self_audit_technical_inquiries drop constraint self_audit_technical_inquiries_occurrence_check;
alter table self_audit_technical_inquiries alter column occurrence set not null;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_occurrence_check
  check (occurrence in ('permanent', 'intermittent', 'specific'));

-- every file says what it is: the concern, the vehicle history, the workshop effort, or something else (replies)
alter table self_audit_technical_inquiry_attachments
  add column category text not null default 'other' check (category in ('concern_media', 'vehicle_history', 'workshop_effort', 'other'));

create or replace function public.add_inquiry_attachments(p_inquiry_id uuid, p_comment_id uuid, p_user uuid, p_files jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare f jsonb;
begin
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then raise exception 'Attachments must be a list.'; end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) + (select count(*) from self_audit_technical_inquiry_attachments where inquiry_id = p_inquiry_id) > 60 then
    raise exception 'Too many attachments on this inquiry.';
  end if;
  for f in select value from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if coalesce(f->>'driveFileId', '') = '' then raise exception 'Invalid attachment.'; end if;
    insert into self_audit_technical_inquiry_attachments (inquiry_id, comment_id, drive_file_id, file_name, mime_type, size_bytes, uploaded_by, category)
    values (p_inquiry_id, p_comment_id, f->>'driveFileId', f->>'name', f->>'type', (f->>'size')::bigint, p_user, coalesce(nullif(f->>'category', ''), 'other'));
  end loop;
end;
$$;

-- ---- submitting ------------------------------------------------------------------------------------------------------------
drop function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, boolean, jsonb);

create or replace function public.create_technical_inquiry(
  p_id uuid, p_branch_id uuid, p_work_order text, p_vin text, p_plate text, p_model text, p_system text, p_priority text,
  p_mileage integer, p_dtc text, p_software text, p_occurrence text, p_conditions text, p_parts text,
  p_responsible_name text, p_responsible_role text, p_responsible_phone text,
  p_first_noticed text, p_after_repair text, p_repair_details text,
  p_fault text, p_steps text[], p_comments text, p_terms_confirmed boolean, p_attachments jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare a record; v_no bigint; v_set uuid; v_tech uuid; v_tech_name text; v_steps text[]; v_actions text; v_cat text; v_msg text;
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

  -- the validation requirements of the technical team
  if p_mileage is null then raise exception 'Enter the mileage.'; end if;
  if btrim(coalesce(p_plate, '')) = '' then raise exception 'Enter the plate number.'; end if;
  if btrim(coalesce(p_responsible_name, '')) = '' then raise exception 'Enter the name of the workshop supervisor or delegated responsible.'; end if;
  if btrim(coalesce(p_first_noticed, '')) = '' then raise exception 'Say when the customer first noticed the concern.'; end if;
  if p_occurrence is null or p_occurrence = '' then raise exception 'Say whether the concern is permanent, intermittent or happens under a specific condition.'; end if;
  if p_occurrence <> 'permanent' and btrim(coalesce(p_conditions, '')) = '' then raise exception 'Describe the conditions in which the concern happens.'; end if;
  if p_after_repair = 'yes' and btrim(coalesce(p_repair_details, '')) = '' then raise exception 'Say which previous repair it follows (what, when, work order).'; end if;
  select array_agg(btrim(s)) into v_steps from unnest(coalesce(p_steps, '{}'::text[])) s where btrim(s) <> '';
  if v_steps is null then raise exception 'Write the workshop effort, step by step.'; end if;
  for v_cat in select unnest(array['concern_media', 'vehicle_history']) loop
    if not exists (select 1 from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) f where f->>'category' = v_cat) then
      v_msg := case v_cat when 'concern_media' then 'Attach a photo or video that shows the customer concern.' else 'Attach the full vehicle history (service / repair history).' end;
      raise exception '%', v_msg;
    end if;
  end loop;

  select id into v_set from self_audit_inquiry_term_sets order by created_at desc limit 1;
  select r.technician_id, coalesce(nullif(btrim(u.full_name), ''), u.email) into v_tech, v_tech_name
  from self_audit_inquiry_routing r join self_audit_users u on u.id = r.technician_id
  where r.branch_id = p_branch_id;

  select string_agg(i::text || '. ' || s, E'\n' order by i) into v_actions from unnest(v_steps) with ordinality as t(s, i);

  insert into self_audit_technical_inquiries
    (id, branch_id, work_order_no, vin, plate_number, vehicle_model, system, priority, mileage_km, dtc_codes, software_version, occurrence,
     occurrence_conditions, parts_replaced, responsible_name, responsible_role, responsible_phone, concern_first_noticed, after_previous_repair,
     previous_repair_details, fault_complaint, actions_taken, workshop_steps, workshop_comments, terms_set_id, created_by, created_by_name,
     assigned_to, assigned_to_name)
  values
    (p_id, p_branch_id, upper(btrim(p_work_order)), upper(btrim(p_vin)), upper(btrim(p_plate)), btrim(p_model), p_system, coalesce(p_priority, 'normal'), p_mileage,
     nullif(btrim(coalesce(p_dtc, '')), ''), nullif(btrim(coalesce(p_software, '')), ''), p_occurrence,
     nullif(btrim(coalesce(p_conditions, '')), ''), nullif(btrim(coalesce(p_parts, '')), ''), btrim(p_responsible_name), p_responsible_role,
     nullif(btrim(coalesce(p_responsible_phone, '')), ''), btrim(p_first_noticed), p_after_repair,
     nullif(btrim(coalesce(p_repair_details, '')), ''), btrim(p_fault), v_actions, v_steps,
     nullif(btrim(coalesce(p_comments, '')), ''), v_set, a.user_id, a.name, v_tech, v_tech_name)
  returning inquiry_no into v_no;
  perform add_inquiry_attachments(p_id, null, a.user_id, p_attachments);
  return v_no;
end;
$$;

revoke all on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, boolean, jsonb) from public, anon;
grant execute on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, boolean, jsonb) to authenticated;

-- ---- the terms: the technical team's requirements, replacing the placeholders -----------------------------------------------
insert into self_audit_inquiry_term_sets (terms) values (array[
  'The case is escalated by the workshop supervisor or the specific delegated responsible, who has the full picture of the case, can give the detailed workshop effort and will communicate with the technical team during the investigation.',
  'The technical request form is filled with the needed data: vehicle data (VIN, work order number, mileage and plate number).',
  'The specific customer concern is described and supported with clear media (photos or videos).',
  'The conditions of the concern are clarified (permanent, intermittent, or a specific condition).',
  'It is clarified when the concern appeared for the first time (from the customer interview) and whether it is related to a previous repair.',
  'The full vehicle history (service history or repair history) is attached.',
  'The workshop effort is written accurately and in sequence, supported with media files.'
]);
