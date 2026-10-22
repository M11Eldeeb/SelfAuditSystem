-- Internal audit schedule: at the start of each year the officers set how many internal audits each branch gets (0-4) and
-- pick their dates. Fridays, Saturdays and Saudi holidays are highlighted when picking; holidays can be added or removed.
-- An audit created (Internal Audit -> sample) for the branch near a planned date is linked to it. The daily job reminds the
-- officers to create the audit list before each planned date, and at the start of the year when no plan was set.

create table if not exists self_audit_ia_schedule (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2024 and 2100),
  branch_id uuid not null references self_audit_branches (id) on delete cascade,
  slot integer not null check (slot between 1 and 4),
  planned_date date,
  internal_audit_id uuid references self_audit_internal_audits (id) on delete set null,
  updated_by uuid references self_audit_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (year, branch_id, slot)
);
create index if not exists self_audit_ia_schedule_date_idx on self_audit_ia_schedule (planned_date);

create table if not exists self_audit_holidays (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  name text not null,
  official boolean not null default false,
  created_by uuid references self_audit_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (day, name)
);
create index if not exists self_audit_holidays_day_idx on self_audit_holidays (day);

alter table self_audit_ia_schedule enable row level security;
alter table self_audit_holidays enable row level security;
create policy "officers read ia schedule" on self_audit_ia_schedule for select using ((select current_user_role()::text) = 'officer');
create policy "signed in read holidays" on self_audit_holidays for select using (auth.uid() is not null);

-- Saudi public holidays. Eid dates follow the moon sighting: these are the expected dates - correct them on the page.
insert into self_audit_holidays (day, name, official)
select d::date, h.name, true
from (values
  ('2026-02-22', '2026-02-22', 'Founding Day'),
  ('2026-03-19', '2026-03-23', 'Eid al-Fitr (expected)'),
  ('2026-05-25', '2026-05-30', 'Eid al-Adha (expected)'),
  ('2026-09-23', '2026-09-23', 'National Day'),
  ('2027-02-22', '2027-02-22', 'Founding Day'),
  ('2027-03-08', '2027-03-12', 'Eid al-Fitr (expected)'),
  ('2027-05-15', '2027-05-19', 'Eid al-Adha (expected)'),
  ('2027-09-23', '2027-09-23', 'National Day')
) as h(d_from, d_to, name)
cross join lateral generate_series(h.d_from::date, h.d_to::date, interval '1 day') as d
on conflict do nothing;

insert into self_audit_mail_settings (key, enabled, updated_at) values ('ia_schedule_mails', true, now()) on conflict (key) do nothing;
