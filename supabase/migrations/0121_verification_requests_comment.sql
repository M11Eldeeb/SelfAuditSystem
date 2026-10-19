-- Verification code requests: the technical team / an officer can add a comment with the code or the rejection
-- (shown on the request and e-mailed), and correct the VIN or mileage (who and when is kept).
alter table self_audit_verification_requests add column if not exists answer_comment text, add column if not exists edited_by_name text, add column if not exists edited_at timestamptz;
