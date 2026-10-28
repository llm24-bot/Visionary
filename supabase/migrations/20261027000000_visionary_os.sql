-- ============================================================================
-- Visionary 5.0 "OS" — schema additions
-- Safe to run more than once. Additive only: no column is dropped, renamed or
-- retyped, so every earlier version of the app keeps working against this DB.
--
--  1. tasks: minute-precise scheduling, durations, micro-steps, buffers, people
--  2. profiles: Momentum Grace counters
--  3. reflections: grace flag
--  4. focus_sessions: cloud log of timer / stopwatch sessions (+ journal note)
--  5. booking_pages + booking_requests: private availability links
--  6. RPCs: public_availability (busy intervals only), request_booking
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tasks
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists scheduled_minute smallint;
alter table public.tasks add column if not exists duration_min    smallint;
alter table public.tasks add column if not exists kind            text not null default 'task';
alter table public.tasks add column if not exists people          text;
alter table public.tasks add column if not exists note            text;

-- parent_id gets the same type as tasks.id so it works whether ids are uuid or bigint.
do $$
declare id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_attribute a
  where a.attrelid = 'public.tasks'::regclass and a.attname = 'id' and not a.attisdropped;
  if not exists (
    select 1 from pg_attribute where attrelid = 'public.tasks'::regclass and attname = 'parent_id' and not attisdropped
  ) then
    execute format('alter table public.tasks add column parent_id %s references public.tasks(id) on delete cascade', id_type);
  end if;
end $$;

alter table public.tasks drop constraint if exists vn_tasks_minute_range;
alter table public.tasks add  constraint vn_tasks_minute_range check (scheduled_minute is null or (scheduled_minute between 0 and 59));
alter table public.tasks drop constraint if exists vn_tasks_duration_range;
alter table public.tasks add  constraint vn_tasks_duration_range check (duration_min is null or (duration_min between 1 and 1440));
alter table public.tasks drop constraint if exists vn_tasks_kind;
alter table public.tasks add  constraint vn_tasks_kind check (kind in ('task', 'microstep', 'buffer', 'booking'));
alter table public.tasks drop constraint if exists vn_tasks_people_len;
alter table public.tasks add  constraint vn_tasks_people_len check (people is null or char_length(people) <= 200);
alter table public.tasks drop constraint if exists vn_tasks_note_len;
alter table public.tasks add  constraint vn_tasks_note_len check (note is null or char_length(note) <= 1000);

create index if not exists tasks_user_date_idx   on public.tasks (user_id, date);
create index if not exists tasks_parent_idx      on public.tasks (parent_id) where parent_id is not null;

-- Extend the sanitiser trigger (from the security migration) to the new text columns.
create or replace function public.vn_sanitize_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.text := public.vn_clean_text(new.text, 200);
  if new.text = '' then
    raise exception 'Task text cannot be empty' using errcode = '22023';
  end if;
  if new.category is null or new.category not in ('focus','health','learn','build','rest') then
    new.category := 'focus';
  end if;
  if new.scheduled_hour is not null and (new.scheduled_hour < 0 or new.scheduled_hour > 23) then
    new.scheduled_hour := null;
  end if;
  if new.people is not null then new.people := nullif(public.vn_clean_text(new.people, 200), ''); end if;
  if new.note   is not null then new.note   := nullif(public.vn_clean_text(new.note, 1000), ''); end if;
  if new.kind is null then new.kind := 'task'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. profiles — Momentum Grace
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists grace_days      integer not null default 0;
alter table public.profiles add column if not exists last_grace_date date;
alter table public.profiles add column if not exists settings        jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists vn_profiles_settings_size;
alter table public.profiles add  constraint vn_profiles_settings_size check (pg_column_size(settings) <= 8192);

-- ---------------------------------------------------------------------------
-- 3. reflections
-- ---------------------------------------------------------------------------
alter table public.reflections add column if not exists grace boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. focus_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  label       text not null default 'Free focus',
  category    text,
  task_id     text,
  seconds     integer not null check (seconds between 1 and 86400),
  mode        text not null default 'timer' check (mode in ('timer', 'stopwatch')),
  completed   boolean not null default true,
  note        text,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint vn_fs_label_len check (char_length(label) <= 200),
  constraint vn_fs_note_len  check (note is null or char_length(note) <= 1000),
  constraint vn_fs_category  check (category is null or category in ('focus','health','learn','build','rest'))
);
alter table public.focus_sessions enable row level security;
drop policy if exists "vn_focus_sessions_own" on public.focus_sessions;
create policy "vn_focus_sessions_own" on public.focus_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.focus_sessions from anon, authenticated;
grant select, insert, update, delete on public.focus_sessions to authenticated;
create index if not exists focus_sessions_user_date_idx on public.focus_sessions (user_id, date);

create or replace function public.vn_sanitize_focus_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.label := coalesce(nullif(public.vn_clean_text(new.label, 200), ''), 'Free focus');
  if new.note is not null then new.note := nullif(public.vn_clean_text(new.note, 1000), ''); end if;
  return new;
end $$;
drop trigger if exists vn_sanitize_focus_session on public.focus_sessions;
create trigger vn_sanitize_focus_session before insert or update on public.focus_sessions
  for each row execute function public.vn_sanitize_focus_session();

-- ---------------------------------------------------------------------------
-- 5. booking pages + requests
-- ---------------------------------------------------------------------------
create table if not exists public.booking_pages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  slug          text not null unique,
  title         text not null default 'Book time with me',
  duration_min  smallint not null default 30 check (duration_min between 5 and 480),
  buffer_min    smallint not null default 10 check (buffer_min between 0 and 120),
  start_hour    smallint not null default 9  check (start_hour between 0 and 23),
  end_hour      smallint not null default 17 check (end_hour between 1 and 24),
  days          smallint[] not null default '{1,2,3,4,5}',   -- 0 = Sunday … 6 = Saturday
  horizon_days  smallint not null default 14 check (horizon_days between 1 and 60),
  timezone      text not null default 'UTC',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vn_bp_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  constraint vn_bp_title_len   check (char_length(title) <= 80),
  constraint vn_bp_hours       check (end_hour > start_hour),
  constraint vn_bp_tz_len      check (char_length(timezone) between 1 and 64)
);
alter table public.booking_pages add column if not exists timezone text not null default 'UTC';
alter table public.booking_pages enable row level security;
drop policy if exists "vn_booking_pages_own" on public.booking_pages;
create policy "vn_booking_pages_own" on public.booking_pages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.booking_pages from anon, authenticated;
grant select, insert, update, delete on public.booking_pages to authenticated;
create index if not exists booking_pages_user_idx on public.booking_pages (user_id);

create or replace function public.vn_sanitize_booking_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := coalesce(nullif(public.vn_clean_text(new.title, 80), ''), 'Book time with me');
  new.slug  := lower(new.slug);
  new.timezone := coalesce(nullif(regexp_replace(new.timezone, '[^A-Za-z0-9_/+-]', '', 'g'), ''), 'UTC');
  begin
    perform now() at time zone new.timezone;
  exception when others then
    new.timezone := 'UTC';
  end;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists vn_sanitize_booking_page on public.booking_pages;
create trigger vn_sanitize_booking_page before insert or update on public.booking_pages
  for each row execute function public.vn_sanitize_booking_page();

create table if not exists public.booking_requests (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references public.booking_pages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,  -- the page owner
  requester_name  text not null,
  requester_email text not null,
  starts_at       timestamptz not null,
  duration_min    smallint not null check (duration_min between 5 and 480),
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requester_ip    text,
  created_at      timestamptz not null default now(),
  constraint vn_br_name_len  check (char_length(requester_name) between 1 and 80),
  constraint vn_br_email_fmt check (requester_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(requester_email) <= 254),
  constraint vn_br_note_len  check (note is null or char_length(note) <= 500)
);
alter table public.booking_requests enable row level security;
drop policy if exists "vn_booking_requests_owner" on public.booking_requests;
create policy "vn_booking_requests_owner" on public.booking_requests
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.booking_requests from anon, authenticated;
grant select, update, delete on public.booking_requests to authenticated;  -- inserts go through request_booking()
create index if not exists booking_requests_page_idx on public.booking_requests (page_id, starts_at);
create index if not exists booking_requests_user_idx on public.booking_requests (user_id, status);

-- ---------------------------------------------------------------------------
-- 6. Public RPCs for the booking page (anon callable, security definer)
--    public_availability never returns task titles, notes or people — only the
--    page settings and busy intervals as minutes-from-midnight per date.
-- ---------------------------------------------------------------------------
create or replace function public.public_availability(p_slug text, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  pg    public.booking_pages%rowtype;
  busy  jsonb;
begin
  select * into pg from public.booking_pages where slug = lower(p_slug) and active;
  if not found then return null; end if;
  if p_to < p_from then return null; end if;
  if p_to - p_from > 60 then p_to := p_from + 60; end if;

  select coalesce(jsonb_agg(jsonb_build_object('date', b.d, 'start', b.s, 'end', b.e) order by b.d, b.s), '[]'::jsonb)
  into busy
  from (
    select t.date::text as d,
           t.scheduled_hour * 60 + coalesce(t.scheduled_minute, 0) as s,
           t.scheduled_hour * 60 + coalesce(t.scheduled_minute, 0) + coalesce(t.duration_min, 60) as e
    from public.tasks t
    where t.user_id = pg.user_id and t.scheduled_hour is not null
      and t.date between p_from and p_to and not t.completed
    union all
    select (r.starts_at at time zone pg.timezone)::date::text,
           extract(hour from r.starts_at at time zone pg.timezone)::int * 60 + extract(minute from r.starts_at at time zone pg.timezone)::int,
           extract(hour from r.starts_at at time zone pg.timezone)::int * 60 + extract(minute from r.starts_at at time zone pg.timezone)::int + r.duration_min
    from public.booking_requests r
    where r.page_id = pg.id and r.status <> 'declined'
      and r.starts_at >= p_from::timestamptz and r.starts_at < (p_to + 1)::timestamptz
  ) b;

  return jsonb_build_object(
    'title', pg.title,
    'duration_min', pg.duration_min,
    'buffer_min', pg.buffer_min,
    'start_hour', pg.start_hour,
    'end_hour', pg.end_hour,
    'days', to_jsonb(pg.days),
    'horizon_days', pg.horizon_days,
    'timezone', pg.timezone,
    'busy', busy
  );
end $$;
revoke all on function public.public_availability(text, date, date) from public;
grant execute on function public.public_availability(text, date, date) to anon, authenticated;

create or replace function public.request_booking(
  p_slug text, p_starts_at timestamptz, p_name text, p_email text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pg       public.booking_pages%rowtype;
  recent   int;
  clash    int;
  new_id   uuid;
  v_name   text := public.vn_clean_text(p_name, 80);
  v_email  text := lower(public.vn_clean_text(p_email, 254));
  v_note   text := nullif(public.vn_clean_text(p_note, 500), '');
begin
  select * into pg from public.booking_pages where slug = lower(p_slug) and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'This booking link is not available.'); end if;
  if v_name is null or v_name = '' then return jsonb_build_object('ok', false, 'error', 'Please add your name.'); end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Please use a valid email address.'); end if;
  if p_starts_at < now() then return jsonb_build_object('ok', false, 'error', 'That time has already passed.'); end if;
  if p_starts_at > now() + (pg.horizon_days || ' days')::interval then
    return jsonb_build_object('ok', false, 'error', 'That date is too far ahead for this link.');
  end if;

  -- Rate limit: at most 20 requests per page per hour, 3 per email per day.
  select count(*) into recent from public.booking_requests where page_id = pg.id and created_at > now() - interval '1 hour';
  if recent >= 20 then return jsonb_build_object('ok', false, 'error', 'This link is busy right now. Please try again later.'); end if;
  select count(*) into recent from public.booking_requests where page_id = pg.id and requester_email = v_email and created_at > now() - interval '1 day';
  if recent >= 3 then return jsonb_build_object('ok', false, 'error', 'You already have pending requests for this link.'); end if;

  -- Clash check against existing non-declined requests (with buffer).
  select count(*) into clash from public.booking_requests r
  where r.page_id = pg.id and r.status <> 'declined'
    and r.starts_at < p_starts_at + ((pg.duration_min + pg.buffer_min) || ' minutes')::interval
    and r.starts_at + ((r.duration_min + pg.buffer_min) || ' minutes')::interval > p_starts_at;
  if clash > 0 then return jsonb_build_object('ok', false, 'error', 'That slot was just taken. Please pick another.'); end if;

  insert into public.booking_requests (page_id, user_id, requester_name, requester_email, starts_at, duration_min, note)
  values (pg.id, pg.user_id, v_name, v_email, p_starts_at, pg.duration_min, v_note)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'duration_min', pg.duration_min);
end $$;
revoke all on function public.request_booking(text, timestamptz, text, text, text) from public;
grant execute on function public.request_booking(text, timestamptz, text, text, text) to anon, authenticated;

-- Accepting a request creates a task block for the owner; done client-side with
-- the owner's own session (RLS), so no extra privileges are needed here.
