-- supabase-schema.sql
-- Educational prototype. Run once in Supabase Dashboard > SQL Editor.
-- Uses fictional sample data only.

-- ============ TABLES ============
create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role      text not null check (role in ('admin', 'staff'))
);

create table if not exists public.patients (
  id         bigint generated always as identity primary key,
  full_name  text not null check (char_length(full_name) between 2 and 100),
  age        integer check (age between 0 and 130),
  gender     text check (gender in ('Male', 'Female', 'Other')),
  phone      text check (phone ~ '^[0-9+() -]{7,20}$'),
  created_at timestamptz default now()
);

create table if not exists public.doctors (
  id             bigint generated always as identity primary key,
  full_name      text not null check (char_length(full_name) between 2 and 100),
  specialization text not null check (char_length(specialization) between 2 and 100),
  phone          text check (phone ~ '^[0-9+() -]{7,20}$'),
  created_at     timestamptz default now()
);

create table if not exists public.appointments (
  id               bigint generated always as identity primary key,
  patient_id       bigint not null references public.patients(id) on delete cascade,
  doctor_id        bigint not null references public.doctors(id)  on delete cascade,
  appointment_date timestamptz not null,
  status           text not null default 'Scheduled'
                   check (status in ('Scheduled', 'Completed', 'Cancelled')),
  created_at       timestamptz default now()
);

-- ============ INDEXES ============
create index if not exists idx_patients_name      on public.patients (full_name);
create index if not exists idx_doctors_name       on public.doctors (full_name);
create index if not exists idx_appt_patient       on public.appointments (patient_id);
create index if not exists idx_appt_doctor        on public.appointments (doctor_id);
create index if not exists idx_appt_date          on public.appointments (appointment_date);
create index if not exists idx_appt_created       on public.appointments (created_at desc);

-- ============ NO PAST APPOINTMENTS (server-side check) ============
-- A CHECK constraint cannot use now() safely, so a trigger is used instead.
-- On UPDATE it only checks when the date itself changes (status edits stay allowed).
create or replace function public.prevent_past_appointments()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.appointment_date < now() - interval '1 minute' then
      raise exception 'Appointment date cannot be in the past';
    end if;
  elsif new.appointment_date is distinct from old.appointment_date then
    if new.appointment_date < now() - interval '1 minute' then
      raise exception 'Appointment date cannot be in the past';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_no_past_appointments on public.appointments;
create trigger trg_no_past_appointments
  before insert or update on public.appointments
  for each row execute function public.prevent_past_appointments();

-- ============ AUTHORIZATION HELPER ============
-- True only if the logged-in user has a row in profiles with a valid role.
-- SECURITY DEFINER lets it read profiles without recursive RLS checks.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'staff')
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- ============ PRIVILEGES ============
-- Anonymous (not logged in) users get nothing.
-- Logged-in users can only READ profiles (no insert/update/delete => no self-promotion).
revoke all on table public.profiles, public.patients, public.doctors, public.appointments
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete
  on public.patients, public.doctors, public.appointments to authenticated;

-- ============ ROW LEVEL SECURITY ============
alter table public.profiles     enable row level security;
alter table public.patients     enable row level security;
alter table public.doctors      enable row level security;
alter table public.appointments enable row level security;

-- Profiles: a user can read only their own row. No write policies exist,
-- so profiles/roles can only be created or changed in the SQL Editor/dashboard.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

-- Hospital records: only authorized staff/admin.
drop policy if exists "staff access patients" on public.patients;
create policy "staff access patients" on public.patients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff access doctors" on public.doctors;
create policy "staff access doctors" on public.doctors
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff access appointments" on public.appointments;
create policy "staff access appointments" on public.appointments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============ OPTIONAL SAMPLE DOCTORS (fictional) ============
insert into public.doctors (full_name, specialization, phone)
select * from (values
  ('Dr. Asha Verma',   'Cardiology',       '+91 90000 00001'),
  ('Dr. Rohan Mehta',  'Pediatrics',       '+91 90000 00002'),
  ('Dr. Meera Iyer',   'General Medicine', '+91 90000 00003')
) as v(full_name, specialization, phone)
where not exists (select 1 from public.doctors);

-- ============ FIRST ADMIN (run AFTER creating the user in the dashboard) ============
-- Replace the email and name, uncomment, and run:
--
-- insert into public.profiles (id, full_name, role)
-- select id, 'Admin Name', 'admin' from auth.users where email = 'admin@example.com';