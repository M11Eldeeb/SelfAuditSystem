-- Technical Inquiries, round 2 of the form:
--   * a case can carry previous work orders (WIPs) of the same problem; every work order has its own workshop effort:
--     numbered steps, each with its own files, plus a VDS report, a photo of the work order and a photo of the agreement
--   * a previous work order has "customer previous concern" (what the customer complained about then)
--   * "urgent" becomes "is the car in the workshop or out"
--   * how the concern happens: permanent or intermittent, with ticked conditions ("when it happens")
-- (The inquiries table was empty when this ran.)

-- ---- the car -----------------------------------------------------------------------------------------------------------------
alter table self_audit_technical_inquiries add column vehicle_location text not null default 'out' check (vehicle_location in ('in_workshop', 'out'));
alter table self_audit_technical_inquiries alter column vehicle_location drop default;
alter table self_audit_technical_inquiries drop column priority;

-- ---- how the concern happens ---------------------------------------------------------------------------------------------------
alter table self_audit_technical_inquiries drop constraint self_audit_technical_inquiries_occurrence_check;
alter table self_audit_technical_inquiries add constraint self_audit_technical_inquiries_occurrence_check check (occurrence in ('permanent', 'intermittent'));
alter table self_audit_technical_inquiries
  add column occurrence_keys text[] not null
    check (cardinality(occurrence_keys) between 1 and 17 and occurrence_keys <@ array[
      'always', 'cold_start', 'hot_engine', 'idling', 'accelerating', 'braking', 'highway', 'low_speed', 'turning',
      'reversing', 'gear_change', 'rough_road', 'ac_on', 'rain', 'parked', 'charging', 'other']);
-- occurrence_conditions now holds only the free text of the "other" condition
alter table self_audit_technical_inquiries drop column workshop_steps;

-- ---- the work orders of a case ---------------------------------------------------------------------------------------------------
create table self_audit_inquiry_work_orders (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references self_audit_technical_inquiries (id) on delete cascade,
  position integer not null check (position between 0 and 9),
  work_order_no text not null check (work_order_no = upper(btrim(work_order_no)) and char_length(work_order_no) between 1 and 40),
  previous_concern text check (previous_concern is null or char_length(previous_concern) <= 4000),
  steps text[] not null check (cardinality(steps) between 1 and 30),
  unique (inquiry_id, position),
  unique (inquiry_id, work_order_no)
);
alter table self_audit_inquiry_work_orders enable row level security;
create policy "read inquiry work orders" on self_audit_inquiry_work_orders for select using (
  exists (select 1 from self_audit_technical_inquiries i where i.id = inquiry_id)
);

-- ---- files: which work order and step they belong to, and three new kinds ------------------------------------------------------------
alter table self_audit_technical_inquiry_attachments drop constraint self_audit_technical_inquiry_attachments_category_check;
alter table self_audit_technical_inquiry_attachments add constraint self_audit_technical_inquiry_attachments_category_check
  check (category in ('concern_media', 'vehicle_history', 'workshop_effort', 'vds_report', 'work_order_photo', 'agreement_photo', 'other'));
alter table self_audit_technical_inquiry_attachments
  add column wip_id uuid references self_audit_inquiry_work_orders (id) on delete cascade,
  add column step_no integer check (step_no is null or step_no >= 1);

drop function public.add_inquiry_attachments(uuid, uuid, uuid, jsonb);
create or replace function public.add_inquiry_attachments(p_inquiry_id uuid, p_comment_id uuid, p_user uuid, p_files jsonb, p_wip_id uuid default null, p_step_no integer default null, p_category text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare f jsonb;
begin
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then raise exception 'Attachments must be a list.'; end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) + (select count(*) from self_audit_technical_inquiry_attachments where inquiry_id = p_inquiry_id) > 200 then
    raise exception 'Too many attachments on this inquiry.';
  end if;
  for f in select value from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if coalesce(f->>'driveFileId', '') = '' then raise exception 'Invalid attachment.'; end if;
    insert into self_audit_technical_inquiry_attachments (inquiry_id, comment_id, drive_file_id, file_name, mime_type, size_bytes, uploaded_by, category, wip_id, step_no)
    values (p_inquiry_id, p_comment_id, f->>'driveFileId', f->>'name', f->>'type', (f->>'size')::bigint, p_user,
            coalesce(p_category, nullif(f->>'category', ''), 'other'), p_wip_id, p_step_no);
  end loop;
end;
$$;
revoke all on function public.add_inquiry_attachments(uuid, uuid, uuid, jsonb, uuid, integer, text) from public, anon, authenticated;

-- ---- submitting ------------------------------------------------------------------------------------------------------------------
drop function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, text[], jsonb);

-- p_work_orders: [{"workOrder": "HER-1", "previousConcern": null, "steps": [{"text": "...", "files": [file...]}],
--                  "vds": [file...], "woPhotos": [file...], "agreementPhotos": [file...]}, ...]  - the first is the current work order.
-- p_attachments: the case-level files (concern media and vehicle history), each with its "category".
create or replace function public.create_technical_inquiry(
  p_id uuid, p_branch_id uuid, p_work_order text, p_vin text, p_plate text, p_model text, p_system text, p_vehicle_location text,
  p_mileage integer, p_dtc text, p_software text, p_occurrence text, p_condition_keys text[], p_conditions text, p_parts text,
  p_responsible_name text, p_responsible_role text, p_responsible_phone text,
  p_first_noticed text, p_after_repair text, p_repair_details text,
  p_fault text, p_comments text, p_reasons text[], p_work_orders jsonb, p_attachments jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  a record; v_no bigint; v_tech uuid; v_tech_name text; v_cat text; v_msg text; v_reasons text[]; v_keys text[];
  w jsonb; i integer; j integer; v_wip uuid; v_wo text; v_steps text[]; v_actions text := ''; v_seen text[] := '{}';
begin
  select * into a from inquiry_actor();
  if a.user_id is null then raise exception 'Please sign in again.'; end if;
  if a.role = 'branch_admin' then
    if p_branch_id is distinct from a.branch_id then raise exception 'You can only submit for your own branch.'; end if;
    if not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Technical Inquiries is coming soon for branch admins.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'You cannot submit a technical inquiry.';
  end if;

  select array_agg(distinct r) into v_reasons from unnest(coalesce(p_reasons, '{}'::text[])) r;
  if v_reasons is null then raise exception 'A case can only go to the technical team when one of the conditions is met - tick at least one.'; end if;
  if not (v_reasons <@ array['moc', 'repeat_complaint', 'low_mileage', 'unsolved']) then raise exception 'Unknown condition.'; end if;
  if 'low_mileage' = any(v_reasons) and p_mileage >= 1000 then raise exception 'The low mileage condition needs a mileage below 1,000 km.'; end if;

  if p_vehicle_location is null or p_vehicle_location not in ('in_workshop', 'out') then raise exception 'Say whether the car is in the workshop or out.'; end if;
  if p_mileage is null then raise exception 'Enter the mileage.'; end if;
  if btrim(coalesce(p_plate, '')) = '' then raise exception 'Enter the plate number.'; end if;
  if btrim(coalesce(p_responsible_name, '')) = '' then raise exception 'Enter the name of the workshop supervisor or delegated responsible.'; end if;
  if btrim(coalesce(p_first_noticed, '')) = '' then raise exception 'Say when the customer first noticed the concern.'; end if;
  if p_occurrence is null or p_occurrence not in ('permanent', 'intermittent') then raise exception 'Say whether the concern is permanent or intermittent.'; end if;
  select array_agg(distinct k) into v_keys from unnest(coalesce(p_condition_keys, '{}'::text[])) k;
  if v_keys is null then raise exception 'Tick when the concern happens.'; end if;
  if 'other' = any(v_keys) and btrim(coalesce(p_conditions, '')) = '' then raise exception 'Describe the other condition in which the concern happens.'; end if;
  if p_after_repair = 'yes' and btrim(coalesce(p_repair_details, '')) = '' then raise exception 'Say which previous repair it follows (what, when, work order).'; end if;
  for v_cat in select unnest(array['concern_media', 'vehicle_history']) loop
    if not exists (select 1 from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) f where f->>'category' = v_cat) then
      v_msg := case v_cat when 'concern_media' then 'Attach a photo or video that shows the customer concern.' else 'Attach the full vehicle history (service / repair history).' end;
      raise exception '%', v_msg;
    end if;
  end loop;

  -- the work orders: the first is the current one, every other is a previous work order of the same problem
  if jsonb_typeof(p_work_orders) <> 'array' or jsonb_array_length(p_work_orders) < 1 or jsonb_array_length(p_work_orders) > 10 then
    raise exception 'Enter the work order, and up to 9 previous work orders.';
  end if;
  if upper(btrim(p_work_order)) is distinct from upper(btrim(p_work_orders->0->>'workOrder')) then raise exception 'The first work order must be the current one.'; end if;
  for i in 0 .. jsonb_array_length(p_work_orders) - 1 loop
    w := p_work_orders->i;
    v_wo := upper(btrim(coalesce(w->>'workOrder', '')));
    if v_wo = '' then raise exception 'Enter every work order number.'; end if;
    if v_wo = any(v_seen) then raise exception 'The work order % is listed twice.', v_wo; end if;
    v_seen := v_seen || v_wo;
    if i > 0 and btrim(coalesce(w->>'previousConcern', '')) = '' then raise exception 'Write the customer previous concern of work order %.', v_wo; end if;
    if jsonb_typeof(w->'steps') <> 'array' or jsonb_array_length(w->'steps') = 0 or exists (select 1 from jsonb_array_elements(w->'steps') x where btrim(coalesce(x->>'text', '')) = '') then
      raise exception 'Write the workshop effort of work order %, step by step.', v_wo;
    end if;
    if jsonb_array_length(coalesce(w->'vds', '[]'::jsonb)) = 0 then raise exception 'Attach the VDS report of work order %.', v_wo; end if;
    if jsonb_array_length(coalesce(w->'woPhotos', '[]'::jsonb)) = 0 then raise exception 'Attach a photo of work order %.', v_wo; end if;
    if jsonb_array_length(coalesce(w->'agreementPhotos', '[]'::jsonb)) = 0 then raise exception 'Attach a photo of the agreement of work order %.', v_wo; end if;
  end loop;

  select r.technician_id, coalesce(nullif(btrim(u.full_name), ''), u.email) into v_tech, v_tech_name
  from self_audit_inquiry_routing r join self_audit_users u on u.id = r.technician_id
  where r.branch_id = p_branch_id;

  -- the text of the whole effort (kept for searching and the list)
  for i in 0 .. jsonb_array_length(p_work_orders) - 1 loop
    w := p_work_orders->i;
    v_actions := v_actions || case when i > 0 then E'\n\n' else '' end || upper(btrim(w->>'workOrder')) || E':';
    for j in 0 .. jsonb_array_length(w->'steps') - 1 loop
      v_actions := v_actions || E'\n' || (j + 1)::text || '. ' || btrim(w->'steps'->j->>'text');
    end loop;
  end loop;

  insert into self_audit_technical_inquiries
    (id, branch_id, work_order_no, vin, plate_number, vehicle_model, system, vehicle_location, mileage_km, dtc_codes, software_version, occurrence,
     occurrence_keys, occurrence_conditions, parts_replaced, responsible_name, responsible_role, responsible_phone, concern_first_noticed, after_previous_repair,
     previous_repair_details, fault_complaint, actions_taken, workshop_comments, submit_reasons, created_by, created_by_name, assigned_to, assigned_to_name)
  values
    (p_id, p_branch_id, upper(btrim(p_work_order)), upper(btrim(p_vin)), upper(btrim(p_plate)), btrim(p_model), p_system, p_vehicle_location, p_mileage,
     nullif(btrim(coalesce(p_dtc, '')), ''), nullif(btrim(coalesce(p_software, '')), ''), p_occurrence,
     v_keys, nullif(btrim(coalesce(p_conditions, '')), ''), nullif(btrim(coalesce(p_parts, '')), ''), btrim(p_responsible_name), p_responsible_role,
     nullif(btrim(coalesce(p_responsible_phone, '')), ''), btrim(p_first_noticed), p_after_repair,
     nullif(btrim(coalesce(p_repair_details, '')), ''), btrim(p_fault), v_actions,
     nullif(btrim(coalesce(p_comments, '')), ''), v_reasons, a.user_id, a.name, v_tech, v_tech_name)
  returning inquiry_no into v_no;

  perform add_inquiry_attachments(p_id, null, a.user_id, p_attachments);

  for i in 0 .. jsonb_array_length(p_work_orders) - 1 loop
    w := p_work_orders->i;
    select array_agg(btrim(x->>'text') order by ord) into v_steps from jsonb_array_elements(w->'steps') with ordinality as t(x, ord);
    insert into self_audit_inquiry_work_orders (inquiry_id, position, work_order_no, previous_concern, steps)
    values (p_id, i, upper(btrim(w->>'workOrder')), case when i > 0 then btrim(w->>'previousConcern') end, v_steps)
    returning id into v_wip;
    for j in 0 .. jsonb_array_length(w->'steps') - 1 loop
      perform add_inquiry_attachments(p_id, null, a.user_id, coalesce(w->'steps'->j->'files', '[]'::jsonb), v_wip, j + 1, 'workshop_effort');
    end loop;
    perform add_inquiry_attachments(p_id, null, a.user_id, w->'vds', v_wip, null, 'vds_report');
    perform add_inquiry_attachments(p_id, null, a.user_id, w->'woPhotos', v_wip, null, 'work_order_photo');
    perform add_inquiry_attachments(p_id, null, a.user_id, w->'agreementPhotos', v_wip, null, 'agreement_photo');
  end loop;
  return v_no;
end;
$$;

revoke all on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text[], text, text, text, text, text, text, text, text, text, text, text[], jsonb, jsonb) from public, anon;
grant execute on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text[], text, text, text, text, text, text, text, text, text, text, text[], jsonb, jsonb) to authenticated;

-- A missing "steps" / work orders list must be refused too (jsonb_typeof of nothing is null, and null passes an "<>" test).
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_technical_inquiry';
  d := replace(d, 'jsonb_typeof(w->''steps'') <> ''array''', 'coalesce(jsonb_typeof(w->''steps''), '''') <> ''array''');
  d := replace(d, 'jsonb_typeof(p_work_orders) <> ''array''', 'coalesce(jsonb_typeof(p_work_orders), '''') <> ''array''');
  execute d;
end $$;
