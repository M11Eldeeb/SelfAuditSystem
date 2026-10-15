-- Technical Inquiries: the terms a workshop had to tick before submitting are gone - the form itself now asks for (and
-- the database requires) everything the technical team needs. The term sets table and the per-case link to it are dropped.
-- (The inquiries table was empty when this ran.)

alter table self_audit_technical_inquiries drop column terms_set_id;
drop table self_audit_inquiry_term_sets;

drop function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, boolean, jsonb);

create or replace function public.create_technical_inquiry(
  p_id uuid, p_branch_id uuid, p_work_order text, p_vin text, p_plate text, p_model text, p_system text, p_priority text,
  p_mileage integer, p_dtc text, p_software text, p_occurrence text, p_conditions text, p_parts text,
  p_responsible_name text, p_responsible_role text, p_responsible_phone text,
  p_first_noticed text, p_after_repair text, p_repair_details text,
  p_fault text, p_steps text[], p_comments text, p_attachments jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare a record; v_no bigint; v_tech uuid; v_tech_name text; v_steps text[]; v_actions text; v_cat text; v_msg text;
begin
  select * into a from inquiry_actor();
  if a.user_id is null then raise exception 'Please sign in again.'; end if;
  if a.role = 'branch_admin' then
    if p_branch_id is distinct from a.branch_id then raise exception 'You can only submit for your own branch.'; end if;
    if not feature_enabled('technical_inquiries_branch_admins') then raise exception 'Technical Inquiries is coming soon for branch admins.'; end if;
  elsif a.role <> 'officer' then
    raise exception 'You cannot submit a technical inquiry.';
  end if;

  -- the validation requirements of the technical team (fault codes and software version stay optional)
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

  select r.technician_id, coalesce(nullif(btrim(u.full_name), ''), u.email) into v_tech, v_tech_name
  from self_audit_inquiry_routing r join self_audit_users u on u.id = r.technician_id
  where r.branch_id = p_branch_id;

  select string_agg(i::text || '. ' || s, E'\n' order by i) into v_actions from unnest(v_steps) with ordinality as t(s, i);

  insert into self_audit_technical_inquiries
    (id, branch_id, work_order_no, vin, plate_number, vehicle_model, system, priority, mileage_km, dtc_codes, software_version, occurrence,
     occurrence_conditions, parts_replaced, responsible_name, responsible_role, responsible_phone, concern_first_noticed, after_previous_repair,
     previous_repair_details, fault_complaint, actions_taken, workshop_steps, workshop_comments, created_by, created_by_name,
     assigned_to, assigned_to_name)
  values
    (p_id, p_branch_id, upper(btrim(p_work_order)), upper(btrim(p_vin)), upper(btrim(p_plate)), btrim(p_model), p_system, coalesce(p_priority, 'normal'), p_mileage,
     nullif(btrim(coalesce(p_dtc, '')), ''), nullif(btrim(coalesce(p_software, '')), ''), p_occurrence,
     nullif(btrim(coalesce(p_conditions, '')), ''), nullif(btrim(coalesce(p_parts, '')), ''), btrim(p_responsible_name), p_responsible_role,
     nullif(btrim(coalesce(p_responsible_phone, '')), ''), btrim(p_first_noticed), p_after_repair,
     nullif(btrim(coalesce(p_repair_details, '')), ''), btrim(p_fault), v_actions, v_steps,
     nullif(btrim(coalesce(p_comments, '')), ''), a.user_id, a.name, v_tech, v_tech_name)
  returning inquiry_no into v_no;
  perform add_inquiry_attachments(p_id, null, a.user_id, p_attachments);
  return v_no;
end;
$$;

revoke all on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.create_technical_inquiry(uuid, uuid, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, text, text[], text, jsonb) to authenticated;
