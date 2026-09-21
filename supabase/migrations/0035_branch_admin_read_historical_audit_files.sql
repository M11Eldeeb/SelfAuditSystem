-- Branch admins now see historical audit results for their own branch on
-- /audit/results, including any attached PDF. warranty-room-files had no
-- SELECT policy that covered them for the historical-audits/ prefix (its
-- only branch-admin policy is scoped to scrap-request/supplier-collection
-- ids). Path itself doesn't encode branch_id, so check against the owning
-- self_audit_historical_audits row instead.
create policy "branch admins read own historical audit files"
  on storage.objects
  for select
  using (
    bucket_id = 'warranty-room-files'
    and (storage.foldername(name))[1] = 'historical-audits'
    and exists (
      select 1 from self_audit_historical_audits h
      where h.pdf_path = objects.name and h.branch_id = current_user_branch_id()
    )
  );
