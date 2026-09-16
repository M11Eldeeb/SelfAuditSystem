-- Performance-only fix, no access-control change: current_user_role() and
-- current_user_branch_id() are STABLE, but calling them bare inside a
-- policy's USING/WITH CHECK means Postgres can still re-evaluate them (and
-- their underlying `select ... from self_audit_users where id = auth.uid()`
-- lookup) once per row during a bulk INSERT/UPDATE - exactly the pattern
-- Supabase's own linter already flags elsewhere in this project
-- (auth_rls_initplan, on self_audit_users/audit_questions/etc, which call
-- auth.uid() directly). These policies call a wrapper function instead, so
-- the linter doesn't catch it, but the same fix applies: wrapping the call
-- as `(select current_user_role())` forces Postgres to compute it once per
-- statement via an InitPlan instead of once per row. This is very likely why
-- Warranty Room's chunked uploads (300-500 rows/upsert) run ~3s per chunk
-- even with no triggers and correct indexes - confirmed no triggers exist
-- and every relevant upsert's onConflict target has a matching unique index,
-- leaving RLS evaluation cost as the remaining explanation.
--
-- Every USING/WITH CHECK expression below is logically identical to what it
-- replaces - only the auth-function calls are wrapped in a scalar subquery.

alter policy "officers manage claims" on public.self_audit_claims
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "branch admins read own claims" on public.self_audit_claims
  using (branch_id = (select current_user_branch_id()));

alter policy "officers manage claim_parts" on public.self_audit_claim_parts
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "branch admins read own claim_parts" on public.self_audit_claim_parts
  using (branch_id = (select current_user_branch_id()));

alter policy "officers manage scrap_requests" on public.self_audit_scrap_requests
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "branch admins read own scrap_requests" on public.self_audit_scrap_requests
  using (branch_id = (select current_user_branch_id()));

alter policy "branch admins update own scrap_requests" on public.self_audit_scrap_requests
  using (branch_id = (select current_user_branch_id()))
  with check (branch_id = (select current_user_branch_id()));

alter policy "officers manage scrap_request_parts" on public.self_audit_scrap_request_parts
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "branch admins read own scrap_request_parts" on public.self_audit_scrap_request_parts
  using (exists (
    select 1 from self_audit_scrap_requests r
    where r.id = self_audit_scrap_request_parts.scrap_request_id
      and r.branch_id = (select current_user_branch_id())
  ));

alter policy "officers manage scrapped_parts" on public.self_audit_scrapped_parts
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "officers manage supplier_collection_parts" on public.self_audit_supplier_collection_parts
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);

alter policy "branch admins read own supplier_collection_parts" on public.self_audit_supplier_collection_parts
  using (exists (
    select 1 from self_audit_supplier_collections c
    where c.id = self_audit_supplier_collection_parts.collection_id
      and c.branch_id = (select current_user_branch_id())
  ));

alter policy "officers manage upload_batches" on public.self_audit_upload_batches
  using ((select current_user_role()) = 'officer'::user_role)
  with check ((select current_user_role()) = 'officer'::user_role);
