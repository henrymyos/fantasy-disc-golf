-- Game-weekend live features:
--
--   live_feed_events        one row per rostered player per score refresh that
--                           changed their live stats during an in-progress
--                           tournament (position moves, hot rounds, aces, ...).
--                           Written by the PDGA import (service role); the
--                           matchup pages render the rows for the two teams.
--
--   matchup_prob_snapshots  periodic (score-refresh cadence) snapshots of each
--                           live matchup's actual scores + win probability so
--                           the matchup pages can chart the swing over the
--                           weekend. Written by the post-import gameday pass.
--
-- Also widens the notifications kind constraint with the two new live kinds
-- ('lead_change', 'hot_round'). Without this, those inserts fail silently.

create table if not exists public.live_feed_events (
  id serial primary key,
  tournament_id int not null references public.tournaments(id) on delete cascade,
  player_id int not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('score','position','birdies','bogey_free','eagle','hot_round','ace')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists live_feed_events_tournament_idx
  on public.live_feed_events (tournament_id, created_at desc);

create table if not exists public.matchup_prob_snapshots (
  id serial primary key,
  matchup_id int not null references public.matchups(id) on delete cascade,
  league_id int not null references public.leagues(id) on delete cascade,
  t1_score numeric not null,
  t2_score numeric not null,
  t1_win_pct int not null,
  created_at timestamptz default now()
);

create index if not exists matchup_prob_snapshots_matchup_idx
  on public.matchup_prob_snapshots (matchup_id, created_at);

alter table public.live_feed_events enable row level security;
alter table public.matchup_prob_snapshots enable row level security;

-- Feed events are global tournament facts (no league data) — any signed-in
-- user may read them. Inserts happen via the service role only.
drop policy if exists "Authenticated can view live feed" on public.live_feed_events;
create policy "Authenticated can view live feed" on public.live_feed_events
  for select to authenticated using (true);

-- Snapshots carry league scores — scope reads to that league's members.
drop policy if exists "League members can view prob snapshots" on public.matchup_prob_snapshots;
create policy "League members can view prob snapshots" on public.matchup_prob_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = matchup_prob_snapshots.league_id
        and lm.user_id = auth.uid()
    )
  );

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'trade_proposed','weekly_result','lineup_unset','waiver_result',
    'member_joined','draft_status','lead_change','hot_round'
  ));
