-- ============================================================================
-- Visionary — security hardening
-- Safe to run more than once. Run in the Supabase SQL editor or `supabase db push`.
--
--  1. Row Level Security: every user can only touch their own rows
--  2. Least-privilege grants: anon gets nothing; authenticated gets only CRUD
--  3. Server-side sanitisation + validation of stored text
--  4. AI usage quotas (service role only)
--  5. Security event log (service role only, plus a tiny allowlisted client RPC)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tasks        enable row level security;
alter table public.reflections  enable row level security;
alter table public.profiles     enable row level security;

drop policy if exists "vn_tasks_own"        on public.tasks;
drop policy if exists "vn_reflections_own"  on public.reflections;
drop policy if exists "vn_profiles_own"     on public.profiles;

create policy "vn_tasks_own" on public.tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vn_reflections_own" on public.reflections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vn_profiles_own" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- NOTE: Postgres ORs permissive policies together. If older, broader policies
-- exist on these tables (e.g. "Enable read access for all users"), drop them:
--   select schemaname, tablename, policyname, roles, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename in ('tasks','reflections','profiles');

-- ---------------------------------------------------------------------------
-- 2. Least-privilege grants
-- ---------------------------------------------------------------------------
revoke all on public.tasks, public.reflections, public.profiles from anon;
revoke all on public.tasks, public.reflections, public.profiles from authenticated;
grant select, insert, update, delete on public.tasks, public.reflections, public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sanitise before storing
-- ---------------------------------------------------------------------------
create or replace function public.vn_clean_text(value text, max_len int)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    btrim(regexp_replace(
      regexp_replace(coalesce(value, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
      '\s+', ' ', 'g')),
    max_len);
$$;

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
  return new;
end;
$$;

create or replace function public.vn_sanitize_reflection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.note   := public.vn_clean_text(new.note, 1000);
  new.energy := least(greatest(coalesce(new.energy, 0), 0), 10);
  new.focus  := least(greatest(coalesce(new.focus, 0), 0), 10);
  new.rate   := least(greatest(coalesce(new.rate, 0), 0), 1);
  new.total     := least(greatest(coalesce(new.total, 0), 0), 500);
  new.completed := least(greatest(coalesce(new.completed, 0), 0), new.total);
  return new;
end;
$$;

drop trigger if exists vn_sanitize_task on public.tasks;
create trigger vn_sanitize_task before insert or update on public.tasks
  for each row execute function public.vn_sanitize_task();

drop trigger if exists vn_sanitize_reflection on public.reflections;
create trigger vn_sanitize_reflection before insert or update on public.reflections
  for each row execute function public.vn_sanitize_reflection();

-- ---------------------------------------------------------------------------
-- 4. AI usage quotas
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  day         date        not null default (now() at time zone 'utc')::date,
  mode        text        not null,
  count       int         not null default 0,
  minute_at   timestamptz not null default now(),
  minute_hits int         not null default 0,
  primary key (user_id, day, mode)
);
alter table public.ai_usage enable row level security;   -- no policies: service role only
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.consume_ai_quota(
  p_user uuid, p_mode text, p_daily_limit int, p_minute_limit int
)
returns table (allowed boolean, remaining int, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.ai_usage%rowtype;
  today date := (now() at time zone 'utc')::date;
begin
  insert into public.ai_usage (user_id, day, mode)
  values (p_user, today, p_mode)
  on conflict (user_id, day, mode) do nothing;

  select * into r from public.ai_usage
  where user_id = p_user and day = today and mode = p_mode
  for update;

  if r.minute_at < now() - interval '1 minute' then
    r.minute_at := now();
    r.minute_hits := 0;
  end if;

  if r.count >= p_daily_limit then
    return query select false, 0, 'daily'::text; return;
  end if;
  if r.minute_hits >= p_minute_limit then
    return query select false, p_daily_limit - r.count, 'minute'::text; return;
  end if;

  update public.ai_usage
     set count = r.count + 1, minute_hits = r.minute_hits + 1, minute_at = r.minute_at
   where user_id = p_user and day = today and mode = p_mode;

  return query select true, p_daily_limit - r.count - 1, null::text;
end;
$$;
revoke all on function public.consume_ai_quota(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Security event log
-- ---------------------------------------------------------------------------
create table if not exists public.security_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event      text        not null,
  user_id    uuid,
  ip_hash    text,
  origin     text,
  detail     jsonb       not null default '{}'::jsonb
);
create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_user_idx on public.security_events (user_id, created_at desc);
alter table public.security_events enable row level security;   -- no policies: service role only
revoke all on public.security_events from anon, authenticated;

-- Signed-in clients may record a small, fixed set of account events about themselves.
create or replace function public.log_security_event(p_event text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_event not in ('password_changed','other_sessions_revoked','all_sessions_revoked','data_exported','login_succeeded') then
    raise exception 'event not allowed' using errcode = '22023';
  end if;
  -- simple per-user flood guard: max 20 client events per hour
  if (select count(*) from public.security_events
       where user_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into public.security_events (event, user_id, detail)
  values (p_event, (select auth.uid()), coalesce(p_detail, '{}'::jsonb) - 'password');
end;
$$;
revoke all on function public.log_security_event(text, jsonb) from public, anon;
grant execute on function public.log_security_event(text, jsonb) to authenticated;

-- Keep the log from growing forever (run manually or schedule with pg_cron):
--   delete from public.security_events where created_at < now() - interval '180 days';
