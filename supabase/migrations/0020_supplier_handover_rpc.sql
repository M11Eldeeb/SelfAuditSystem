-- Supplier parts hand-over: the branch enters both representative names,
-- uploads the signed document and a video, and hands the collection over in
-- one step (the "signed_uploaded" status value is kept in the check
-- constraint for a possible future split into two steps, but isn't used
-- yet - the described flow is a single action). Same atomic
-- check-then-write pattern as migration 0019's scrap functions.
create or replace function public.hand_over_supplier_collection(
  p_collection_id uuid,
  p_branch_rep_name text,
  p_supplier_rep_name text,
  p_signed_pdf_path text,
  p_video_path text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_branch_id uuid;
begin
  if current_user_role() <> 'branch_admin' then
    raise exception 'Only a branch admin can hand over a supplier collection.';
  end if;

  select status, branch_id into v_status, v_branch_id
  from self_audit_supplier_collections where id = p_collection_id;

  if v_status is null then
    raise exception 'Supplier collection not found.';
  end if;
  if v_branch_id is distinct from current_user_branch_id() then
    raise exception 'This collection does not belong to your branch.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This collection has already been handed over.';
  end if;
  if p_branch_rep_name is null or trim(p_branch_rep_name) = '' then
    raise exception 'Enter the branch representative name.';
  end if;
  if p_supplier_rep_name is null or trim(p_supplier_rep_name) = '' then
    raise exception 'Enter the supplier representative name.';
  end if;
  if p_signed_pdf_path is null or p_signed_pdf_path = '' then
    raise exception 'Upload the signed document.';
  end if;
  if p_video_path is null or p_video_path = '' then
    raise exception 'Upload a video.';
  end if;

  update self_audit_supplier_collections
  set status = 'handed_over', branch_rep_name = p_branch_rep_name, supplier_rep_name = p_supplier_rep_name,
      signed_pdf_path = p_signed_pdf_path, video_path = p_video_path,
      handed_over_at = now(), handed_over_by = auth.uid()
  where id = p_collection_id;
end;
$$;
