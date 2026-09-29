-- ============================================================================
-- Visionary — site editor (Studio)
--
-- Lets approved admins edit the public website copy (landing page, What's new,
-- Privacy Policy, Terms, 404) in the browser. Everyone can read published
-- content; only rows in site_admins can change it. Every change is kept in
-- site_content_history so it can be restored.
--
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table if not exists public.site_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon, authenticated;
grant select on public.site_admins to authenticated;

drop policy if exists "site_admins: see own row" on public.site_admins;
create policy "site_admins: see own row" on public.site_admins
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.site_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

-- The site owner is the first admin (no-op until that account exists).
-- Add more later with:
--   insert into public.site_admins (user_id)
--   select id from auth.users where lower(email) = 'someone@example.com';
insert into public.site_admins (user_id)
select id from auth.users where lower(email) = 'louisl4764@gmail.com'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Published content: one row per editable region of a page
-- ---------------------------------------------------------------------------
create table if not exists public.site_content (
  page       text        not null,
  region     text        not null,
  html       text        not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (page, region),
  constraint site_content_page_format   check (page   ~ '^[a-z0-9-]{1,40}$'),
  constraint site_content_region_format check (region ~ '^[a-z0-9-]{1,60}$'),
  constraint site_content_size          check (octet_length(html) <= 200000),
  -- Backstop only: the browser sanitises with a strict allowlist before
  -- saving AND again before rendering. This rejects the obvious payloads.
  constraint site_content_no_active_content check (
    html !~* '<\s*/?\s*(script|style|iframe|frame|object|embed|link|meta|base|form|input|textarea|select)[\s>/]'
    and html !~* '\son[a-z]+\s*='
    and html !~* '(href|src)\s*=\s*["'']?\s*(javascript|vbscript|data)\s*:'
  )
);
alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

drop policy if exists "site_content: public read" on public.site_content;
create policy "site_content: public read" on public.site_content
  for select to anon, authenticated using (true);

drop policy if exists "site_content: admins insert" on public.site_content;
create policy "site_content: admins insert" on public.site_content
  for insert to authenticated with check ((select public.is_site_admin()));

drop policy if exists "site_content: admins update" on public.site_content;
create policy "site_content: admins update" on public.site_content
  for update to authenticated
  using ((select public.is_site_admin())) with check ((select public.is_site_admin()));

drop policy if exists "site_content: admins delete" on public.site_content;
create policy "site_content: admins delete" on public.site_content
  for delete to authenticated using ((select public.is_site_admin()));

-- ---------------------------------------------------------------------------
-- History (read by admins, written only by the trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.site_content_history (
  id       bigint generated always as identity primary key,
  page     text        not null,
  region   text        not null,
  html     text,                       -- null = reset to original
  action   text        not null check (action in ('save', 'reset')),
  saved_at timestamptz not null default now(),
  saved_by uuid
);
create index if not exists site_content_history_idx
  on public.site_content_history (page, region, saved_at desc);
alter table public.site_content_history enable row level security;
revoke all on public.site_content_history from anon, authenticated;
grant select on public.site_content_history to authenticated;

drop policy if exists "site_content_history: admins read" on public.site_content_history;
create policy "site_content_history: admins read" on public.site_content_history
  for select to authenticated using ((select public.is_site_admin()));

create or replace function public.site_content_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace function public.site_content_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page text := coalesce(new.page, old.page);
  v_region text := coalesce(new.region, old.region);
begin
  insert into public.site_content_history (page, region, html, action, saved_by)
  values (v_page, v_region,
          case when tg_op = 'DELETE' then null else new.html end,
          case when tg_op = 'DELETE' then 'reset' else 'save' end,
          (select auth.uid()));

  -- keep the newest 50 versions per region
  delete from public.site_content_history h
  where h.page = v_page and h.region = v_region
    and h.id not in (
      select id from public.site_content_history
      where page = v_page and region = v_region
      order by saved_at desc, id desc limit 50);

  insert into public.security_events (event, user_id, detail)
  values ('site_content_' || lower(tg_op), (select auth.uid()),
          jsonb_build_object('page', v_page, 'region', v_region));
  return null;
end;
$$;

drop trigger if exists site_content_stamp on public.site_content;
create trigger site_content_stamp before insert or update on public.site_content
  for each row execute function public.site_content_stamp();

drop trigger if exists site_content_track on public.site_content;
create trigger site_content_track after insert or update or delete on public.site_content
  for each row execute function public.site_content_track();
