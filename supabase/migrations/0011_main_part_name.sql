-- Stores the sheet's "Main Part" column value directly (previously only its
-- presence was used, to derive has_parts) so it can be shown to officers
-- reviewing a claim.
alter table self_audit_claims add column if not exists main_part_name text;
