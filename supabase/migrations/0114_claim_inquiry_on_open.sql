-- Technical Inquiries: the first person of the technical team who opens an unassigned case gets it assigned to them
-- (it shows in "My cases" and nobody else claims it by opening it). Any technician can then delegate it to a colleague
-- with assign_technical_inquiry (0098). Opening a case that already has a technician changes nothing.
create or replace function public.claim_technical_inquiry(p_inquiry_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare a record; r record;
begin
  select * into a from inquiry_actor();
  if a.role is distinct from 'technical' then return; end if;
  select * into r from self_audit_technical_inquiries where id = p_inquiry_id for update;
  if r.id is null or r.assigned_to is not null or r.status in ('closed', 'cancelled') then return; end if;
  update self_audit_technical_inquiries set assigned_to = a.user_id, assigned_to_name = a.name where id = r.id;
  insert into self_audit_technical_inquiry_comments (inquiry_id, kind, author_id, author_name, author_role, body)
  values (r.id, 'assigned', a.user_id, a.name, a.role, 'Assigned to ' || a.name || ' (opened the case)');
end;
$$;

revoke all on function public.claim_technical_inquiry(uuid) from public, anon;
grant execute on function public.claim_technical_inquiry(uuid) to authenticated;
