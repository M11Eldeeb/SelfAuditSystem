-- Technician claims can be saved as a draft (status 'uploading', not sent to the warranty admin) and finished later:
-- the VIN and end of repair may still be empty then. Submitting still requires them (checked by the website).
alter table self_audit_tech_claims alter column vin drop not null;
alter table self_audit_tech_claims alter column end_of_repair drop not null;
