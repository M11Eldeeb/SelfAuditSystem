-- Customer queue: each branch's working hours (when the kiosk takes new customers) and the reception manager's switch.
--  schedule: one entry per weekday (0 = Sunday ... 6 = Saturday): {"open": true, "first": "08:00", "last": "17:30",
--            "breakStart": "12:00", "breakEnd": "13:00"}; null = the default (Sat-Wed 08:00-17:30, Thu 08:00-13:30,
--            break 12:00-13:00, Friday closed).
--  receiving_override: 'open' / 'closed' for one day (override_date, Saudi date), then back to the hours.
alter table self_audit_queue_settings add column if not exists schedule jsonb;
alter table self_audit_queue_settings add column if not exists receiving_override text check (receiving_override in ('open', 'closed'));
alter table self_audit_queue_settings add column if not exists override_date date;
