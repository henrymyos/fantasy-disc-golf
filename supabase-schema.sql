-- =============================================
-- Fantasy Disc Golf — Supabase Schema
-- Run this in your Supabase SQL Editor
-- =============================================

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

-- Players (disc golfers)
create table if not exists players (
  id serial primary key,
  name text not null,
  division text,           -- MPO, FPO, etc.
  pdga_number text,
  avatar_url text
);

-- Leagues
create table if not exists leagues (
  id serial primary key,
  name text not null,
  commissioner_id uuid references profiles(id),
  invite_code text unique not null default upper(substr(md5(random()::text), 1, 8)),
  max_teams int default 12,
  roster_size int default 10,
  starters_count int default 5,
  season_year int default 2025,
  current_week int default 1,
  draft_status text default 'pending' check (draft_status in ('pending','in_progress','complete')),
  scoring_type text default 'placement' check (scoring_type in ('placement','points')),
  created_at timestamptz default now()
);

-- League members (each user's team within a league)
create table if not exists league_members (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  team_name text not null,
  is_commissioner boolean default false,
  draft_position int,
  joined_at timestamptz default now(),
  unique(league_id, user_id)
);

-- Rosters (players assigned to teams)
create table if not exists rosters (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  team_id int references league_members(id) on delete cascade,
  player_id int references players(id),
  is_starter boolean default false,
  acquired_week int default 1,
  unique(league_id, player_id)  -- one team per player per league
);

-- Tournaments (weekly scoring events)
create table if not exists tournaments (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  name text not null,
  week int not null,
  season_year int default 2025,
  start_date date,
  end_date date
);

-- Player tournament results
create table if not exists tournament_results (
  id serial primary key,
  tournament_id int references tournaments(id) on delete cascade,
  player_id int references players(id),
  finishing_position int,
  fantasy_points int default 0,
  unique(tournament_id, player_id)
);

-- Weekly matchups
create table if not exists matchups (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  week int not null,
  team1_id int references league_members(id),
  team2_id int references league_members(id),
  team1_score decimal default 0,
  team2_score decimal default 0,
  is_final boolean default false
);

-- Drafts
create table if not exists drafts (
  id serial primary key,
  league_id int references leagues(id) on delete cascade unique,
  status text default 'pending' check (status in ('pending','in_progress','complete')),
  type text default 'snake',
  current_pick int default 1,
  total_rounds int default 10,
  seconds_per_pick int default 90,
  started_at timestamptz
);

-- Draft picks
create table if not exists draft_picks (
  id serial primary key,
  draft_id int references drafts(id) on delete cascade,
  pick_number int not null,
  round int not null,
  team_id int references league_members(id),
  player_id int references players(id),
  picked_at timestamptz default now(),
  unique(draft_id, pick_number)
);

-- Trades
create table if not exists trades (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  proposer_id int references league_members(id),
  receiver_id int references league_members(id),
  status text default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  message text,
  proposed_at timestamptz default now(),
  resolved_at timestamptz
);

-- Trade players
create table if not exists trade_players (
  id serial primary key,
  trade_id int references trades(id) on delete cascade,
  player_id int references players(id),
  from_team_id int references league_members(id),
  to_team_id int references league_members(id)
);

-- Waiver claims
create table if not exists waiver_claims (
  id serial primary key,
  league_id int references leagues(id) on delete cascade,
  team_id int references league_members(id),
  player_id int references players(id),
  drop_player_id int references players(id),
  priority int,
  status text default 'pending' check (status in ('pending','processed','failed')),
  submitted_at timestamptz default now()
);

-- =============================================
-- Row Level Security
-- =============================================

alter table profiles enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table rosters enable row level security;
alter table tournaments enable row level security;
alter table tournament_results enable row level security;
alter table matchups enable row level security;
alter table drafts enable row level security;
alter table draft_picks enable row level security;
alter table trades enable row level security;
alter table trade_players enable row level security;
alter table waiver_claims enable row level security;

-- profiles: anyone can read, only owner can write
create policy "Public profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = id);

-- players: public read, no public write (seeded by admin)
create policy "Players are publicly readable" on players for select using (true);

-- leagues: members can read, commissioners can write
create policy "League members can view their leagues" on leagues for select
  using (
    id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Authenticated users can create leagues" on leagues for insert
  with check (auth.uid() = commissioner_id);
create policy "Commissioners can update their league" on leagues for update
  using (auth.uid() = commissioner_id);

-- league_members: members of same league can view
create policy "Members can view their league's teams" on league_members for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Authenticated users can join leagues" on league_members for insert
  with check (auth.uid() = user_id);
create policy "Commissioners can update member positions" on league_members for update
  using (
    league_id in (select id from leagues where commissioner_id = auth.uid())
    or user_id = auth.uid()
  );

-- rosters: league members can view, team owner can modify
create policy "League members can view rosters" on rosters for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Team owners can modify rosters" on rosters for insert
  with check (
    team_id in (select id from league_members where user_id = auth.uid())
  );
create policy "Team owners can update their roster" on rosters for update
  using (
    team_id in (select id from league_members where user_id = auth.uid())
    or league_id in (select id from leagues where commissioner_id = auth.uid())
  );
create policy "Team owners can drop players" on rosters for delete
  using (
    team_id in (select id from league_members where user_id = auth.uid())
    or league_id in (select id from leagues where commissioner_id = auth.uid())
  );

-- tournaments: league members can view, commissioners can write
create policy "League members can view tournaments" on tournaments for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Commissioners can create tournaments" on tournaments for insert
  with check (
    league_id in (select id from leagues where commissioner_id = auth.uid())
  );

-- tournament_results: league members can view, commissioners can write
create policy "League members can view results" on tournament_results for select
  using (
    tournament_id in (
      select t.id from tournaments t
      join league_members lm on lm.league_id = t.league_id
      where lm.user_id = auth.uid()
    )
  );
create policy "Commissioners can enter results" on tournament_results for insert
  with check (
    tournament_id in (
      select t.id from tournaments t
      join leagues l on l.id = t.league_id
      where l.commissioner_id = auth.uid()
    )
  );
create policy "Commissioners can update results" on tournament_results for update
  using (
    tournament_id in (
      select t.id from tournaments t
      join leagues l on l.id = t.league_id
      where l.commissioner_id = auth.uid()
    )
  );

-- matchups: league members can view, commissioners can write
create policy "League members can view matchups" on matchups for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Commissioners can create matchups" on matchups for insert
  with check (
    league_id in (select id from leagues where commissioner_id = auth.uid())
  );
create policy "Commissioners can update matchups" on matchups for update
  using (
    league_id in (select id from leagues where commissioner_id = auth.uid())
  );

-- drafts: league members can view, commissioners can write
create policy "League members can view drafts" on drafts for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Commissioners can update drafts" on drafts for update
  using (
    league_id in (select id from leagues where commissioner_id = auth.uid())
  );
create policy "Commissioners can insert drafts" on drafts for insert
  with check (
    league_id in (select id from leagues where commissioner_id = auth.uid())
  );

-- draft_picks: league members can view and insert
create policy "League members can view draft picks" on draft_picks for select
  using (
    draft_id in (
      select d.id from drafts d
      join league_members lm on lm.league_id = d.league_id
      where lm.user_id = auth.uid()
    )
  );
create policy "Team owners can make draft picks" on draft_picks for insert
  with check (
    team_id in (select id from league_members where user_id = auth.uid())
  );

-- trades: league members can view their trades
create policy "League members can view trades" on trades for select
  using (
    league_id in (select league_id from league_members where user_id = auth.uid())
  );
create policy "Team owners can propose trades" on trades for insert
  with check (
    proposer_id in (select id from league_members where user_id = auth.uid())
  );
create policy "Trade participants can update trades" on trades for update
  using (
    proposer_id in (select id from league_members where user_id = auth.uid())
    or receiver_id in (select id from league_members where user_id = auth.uid())
  );

-- trade_players: readable by league members
create policy "League members can view trade players" on trade_players for select
  using (
    trade_id in (
      select t.id from trades t
      join league_members lm on lm.league_id = t.league_id
      where lm.user_id = auth.uid()
    )
  );
create policy "Team owners can add trade players" on trade_players for insert
  with check (
    trade_id in (
      select t.id from trades t
      where t.proposer_id in (select id from league_members where user_id = auth.uid())
    )
  );

-- waiver_claims: team owners
create policy "Team owners can view their claims" on waiver_claims for select
  using (
    team_id in (select id from league_members where user_id = auth.uid())
    or league_id in (select id from leagues where commissioner_id = auth.uid())
  );
create policy "Team owners can submit claims" on waiver_claims for insert
  with check (
    team_id in (select id from league_members where user_id = auth.uid())
  );

-- =============================================
-- Trigger: auto-create profile on signup
-- =============================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- Profile is created explicitly in the signup action
  -- This is a no-op placeholder trigger
  return new;
end;
$$;

-- =============================================
-- Sample player data (PDGA pros)
-- Seed with your own players or use the Google Sheets sync
-- =============================================
insert into players (name, division) values
  ('Calvin Heimburg', 'MPO'),
  ('Paul McBeth', 'MPO'),
  ('Ricky Wysocki', 'MPO'),
  ('Eagle McMahon', 'MPO'),
  ('Chris Dickerson', 'MPO'),
  ('Joel Freeman', 'MPO'),
  ('Adam Hammes', 'MPO'),
  ('Gannon Buhr', 'MPO'),
  ('Drew Gibson', 'MPO'),
  ('Simon Lizotte', 'MPO'),
  ('James Conrad', 'MPO'),
  ('Kyle Klein', 'MPO'),
  ('Mason Ford', 'MPO'),
  ('Matthew Orum', 'MPO'),
  ('Garrett Gurthie', 'MPO'),
  ('Kristin Tattar', 'FPO'),
  ('Catrina Allen', 'FPO'),
  ('Paige Pierce', 'FPO'),
  ('Hailey King', 'FPO'),
  ('Kat Mertsch', 'FPO'),
  ('Jessica Weese', 'FPO'),
  ('Missy Gannon', 'FPO'),
  ('Paige Bjerkaas', 'FPO'),
  ('Rebecca Cox', 'FPO'),
  ('Ella Hansen', 'FPO'),
  ('Sarah Hokom', 'FPO'),
  ('Valerie Mandujano', 'FPO'),
  ('Heather Young', 'FPO')
on conflict do nothing;

-- Migration: add bonus point columns to tournament_results
alter table tournament_results add column if not exists hot_round_count int default 0;
alter table tournament_results add column if not exists bogey_free_count int default 0;
alter table tournament_results add column if not exists ace_count int default 0;
-- Also widen fantasy_points to decimal for tie averaging
alter table tournament_results alter column fantasy_points type decimal(6,1);

-- Migration: add world ranking to players
alter table players add column if not exists world_ranking int;
