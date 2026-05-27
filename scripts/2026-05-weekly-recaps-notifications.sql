-- Weekly recap auto-post + per-user notifications.
--
-- weekly_recaps stores one templated paragraph per (league, week) once the
-- week is finalized. Idempotent on conflict.
--
-- notifications backs an in-app feed at /notifications + an unread-count
-- badge in the navbar. Email/push delivery is a future hook in
-- lib/notifications.ts.

create table if not exists public.weekly_recaps (
  id serial primary key,
  league_id int references public.leagues(id) on delete cascade,
  week int not null,
  body text not null,
  created_at timestamptz default now(),
  unique (league_id, week)
);

create table if not exists public.notifications (
  id serial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  league_id int references public.leagues(id) on delete cascade,
  kind text not null check (kind in ('trade_proposed','weekly_result','lineup_unset')),
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at) where read_at is null;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.weekly_recaps enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "League members can view recaps" on public.weekly_recaps;
create policy "League members can view recaps" on public.weekly_recaps
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = weekly_recaps.league_id
        and lm.user_id = auth.uid()
    )
  );

drop policy if exists "Owner can view notifications" on public.notifications;
create policy "Owner can view notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Owner can update notifications" on public.notifications;
create policy "Owner can update notifications" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Owner can delete notifications" on public.notifications;
create policy "Owner can delete notifications" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
