-- Each account can arrange its menu (drag entries into an order and into folders it names). Kept on the account, so it
-- follows the person to any device. null = the standard menu.
alter table self_audit_users add column if not exists nav_layout jsonb;
