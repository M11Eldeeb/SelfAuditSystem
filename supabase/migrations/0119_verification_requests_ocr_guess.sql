-- What the on-device reader (Tesseract.js) read from the VIN and mileage photos, saved next to the values the
-- workshop typed by hand - to measure its accuracy before letting it fill the fields.
alter table self_audit_verification_requests add column if not exists vin_ocr text, add column if not exists mileage_ocr text;
