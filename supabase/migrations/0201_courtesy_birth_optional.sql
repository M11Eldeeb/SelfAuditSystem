-- Courtesy car loans entered from a branch's manual list (cars already out before the portal): the customer's details
-- may be unknown, so the date of birth may be empty (the customer form still requires it).
alter table self_audit_courtesy_agreements alter column birth_date drop not null;
