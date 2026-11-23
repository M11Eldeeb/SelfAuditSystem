-- Courtesy car return: the advisor marks new damages on the walk-around drawing and adds photos when the car comes back
-- (as at the handover). Photos are also copied to Google Drive: Courtesy Cars / <model> / <VIN - plate> / <mileage> Km.
alter table self_audit_courtesy_agreements
  add column if not exists return_damages jsonb not null default '[]',
  add column if not exists return_photos text[] not null default '{}',
  add column if not exists drive_folder_out text,
  add column if not exists drive_folder_in text;
