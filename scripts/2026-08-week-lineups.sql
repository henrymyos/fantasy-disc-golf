-- Sleeper-style week navigation:
--
--   lineup_plans      a team's staged lineup for a FUTURE league week. Edited
--                     any time (even while the current week's event is locked)
--                     from the Team page's week switcher. Applied to `rosters`
--                     by advanceWeekCore when that week becomes current, then
--                     deleted. starters: [{ player_id, slot: 'MPO'|'FPO',
--                     "order": 1-based slot index within the division }].
--
--   lineup_snapshots  the slot-capped lineup each team actually scored with,
--                     written by finalizeWeekScoresCore when a week is
--                     finalized. Lets past-week views show the real historical
--                     lineup instead of the current roster. lineup:
--                     { starters: [{ player_id, slot, "order" }],
--                       bench: [player_id, ...] }.
--
-- Both are written exclusively by the service role; RLS grants reads only.

create table if not exists public.lineup_plans (
  id serial primary key,
  league_id int not null references public.leagues(id) on delete cascade,
  team_id int not null references public.league_members(id) on delete cascade,
  week int not null,
  starters jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  unique (league_id, team_id, week)
);

create table if not exists public.lineup_snapshots (
  id serial primary key,
  league_id int not null references public.leagues(id) on delete cascade,
  team_id int not null references public.league_members(id) on delete cascade,
  week int not null,
  lineup jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (league_id, team_id, week)
);

alter table public.lineup_plans enable row level security;
alter table public.lineup_snapshots enable row level security;

-- A team's future plans are its own business — only the owner reads them.
drop policy if exists "Owners can view own lineup plans" on public.lineup_plans;
create policy "Owners can view own lineup plans" on public.lineup_plans
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.id = lineup_plans.team_id
        and lm.user_id = auth.uid()
    )
  );

-- Finalized lineups are league history — any member of the league may read.
drop policy if exists "League members can view lineup snapshots" on public.lineup_snapshots;
create policy "League members can view lineup snapshots" on public.lineup_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = lineup_snapshots.league_id
        and lm.user_id = auth.uid()
    )
  );
