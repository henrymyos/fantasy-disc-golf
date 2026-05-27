-- Tables backing the Polish/UX batch:
--   season_archives: per-(league, year) snapshot of standings/rosters/draft.
--   push_subscriptions: one row per browser/device Web Push subscription.
--   user_notification_prefs already lives in an earlier migration.

create table if not exists public.season_archives (
  id serial primary key,
  league_id int references public.leagues(id) on delete cascade,
  season_year int not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  unique (league_id, season_year)
);

alter table public.season_archives enable row level security;

drop policy if exists "League members can view archives" on public.season_archives;
create policy "League members can view archives" on public.season_archives
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = season_archives.league_id
        and lm.user_id = auth.uid()
    )
  );

create table if not exists public.push_subscriptions (
  id serial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Owner can manage push subs" on public.push_subscriptions;
create policy "Owner can manage push subs" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
