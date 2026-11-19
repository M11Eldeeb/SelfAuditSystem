-- Each account's Home page: the widgets it picked (and their order), its sticky notes, to-dos and calendar notes. Kept on the
-- account, so it follows the person to any device. null = the standard Home (reminder, weather, calendar, the role's KPIs).
alter table self_audit_users add column if not exists home_layout jsonb;
