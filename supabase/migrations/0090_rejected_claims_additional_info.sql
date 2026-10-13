-- Optional "additional information" on a rejected claim: customer, vehicle, who handled it,
-- the labours and the parts concerned, and service-history files. Everything is optional;
-- like the rest of the entry it is permanent (the permanent-record trigger already blocks
-- changes to any column other than the "who" columns).

alter table self_audit_rejected_claims
  add column customer_name text check (customer_name is null or char_length(customer_name) between 1 and 120),
  add column vehicle_model text check (vehicle_model is null or char_length(vehicle_model) between 1 and 120),
  add column service_advisor text check (service_advisor is null or char_length(service_advisor) between 1 and 120),
  add column team_leader text check (team_leader is null or char_length(team_leader) between 1 and 120),
  add column labours text[] not null default '{}' check (cardinality(labours) <= 20),
  add column parts text[] not null default '{}' check (cardinality(parts) <= 20);

-- 'file' = an ordinary attachment, 'service_history' = a service-history document.
alter table self_audit_rejected_claim_attachments
  add column kind text not null default 'file' check (kind in ('file', 'service_history'));

drop function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb, text);

create or replace function public.add_rejected_claim(
  p_id uuid,
  p_branch_id uuid,
  p_work_order text,
  p_claim_no text,
  p_date date,
  p_reason text,
  p_attachments jsonb default '[]'::jsonb,
  p_duplicate_of text default null,
  p_customer_name text default null,
  p_vehicle_model text default null,
  p_service_advisor text default null,
  p_team_leader text default null,
  p_labours text[] default '{}',
  p_parts text[] default '{}'
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_labours text[] := coalesce((select array_agg(btrim(x)) from unnest(coalesce(p_labours, '{}')) x where btrim(x) <> ''), '{}');
  v_parts text[] := coalesce((select array_agg(btrim(x)) from unnest(coalesce(p_parts, '{}')) x where btrim(x) <> ''), '{}');
  a jsonb;
begin
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 20 then
    raise exception 'You can attach at most 20 files.';
  end if;
  if p_date > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'The rejection date cannot be in the future.';
  end if;
  if cardinality(v_labours) > 20 or cardinality(v_parts) > 20 then
    raise exception 'You can list at most 20 labours and 20 parts.';
  end if;
  if exists (select 1 from unnest(v_labours || v_parts) x where char_length(x) > 300) then
    raise exception 'A labour or part description is too long.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_name from self_audit_users where id = v_user;

  insert into self_audit_rejected_claims (
    id, branch_id, work_order_no, claim_no, rejection_date, reason, created_by, created_by_name, duplicate_of,
    customer_name, vehicle_model, service_advisor, team_leader, labours, parts
  )
  values (
    p_id, p_branch_id, upper(btrim(p_work_order)), nullif(btrim(coalesce(p_claim_no, '')), ''), p_date, btrim(p_reason), v_user, v_name,
    nullif(upper(btrim(coalesce(p_duplicate_of, ''))), ''),
    nullif(btrim(coalesce(p_customer_name, '')), ''),
    nullif(btrim(coalesce(p_vehicle_model, '')), ''),
    nullif(btrim(coalesce(p_service_advisor, '')), ''),
    nullif(btrim(coalesce(p_team_leader, '')), ''),
    v_labours,
    v_parts
  );

  for a in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if coalesce(a->>'driveFileId', '') = '' then
      raise exception 'Invalid attachment.';
    end if;
    insert into self_audit_rejected_claim_attachments (entry_id, storage, drive_file_id, drive_url, file_name, mime_type, size_bytes, uploaded_by, kind)
    values (p_id, 'drive', a->>'driveFileId', a->>'driveUrl', a->>'name', a->>'type', (a->>'size')::bigint, v_user,
            case when a->>'kind' = 'service_history' then 'service_history' else 'file' end);
  end loop;
  return p_id;
end;
$$;

revoke all on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb, text, text, text, text, text, text[], text[]) from public, anon;
grant execute on function public.add_rejected_claim(uuid, uuid, text, text, date, text, jsonb, text, text, text, text, text, text[], text[]) to authenticated;
