-- warranty-room-files had no INSERT policy for officers at all (its two
-- existing policies are branch-admin-scoped-by-request-id, and an
-- officer-SELECT-only policy) - historical audit PDFs are uploaded by
-- officers under historical-audits/, so they need their own write policy.
create policy "officers manage historical audit files"
  on storage.objects
  for all
  using (bucket_id = 'warranty-room-files' and (storage.foldername(name))[1] = 'historical-audits' and current_user_role() = 'officer'::user_role)
  with check (bucket_id = 'warranty-room-files' and (storage.foldername(name))[1] = 'historical-audits' and current_user_role() = 'officer'::user_role);
