-- Make columns NOT NULL that the app always fills (and that held zero NULLs on
-- 2026-11-09). They were nullable only because the original schema never said
-- otherwise, so the generated DB types (lib/supabase/database.types.ts) report
-- them as "| null" and the code needs `!` on every read.
-- NOT APPLIED YET. Run in the Supabase SQL editor, then regenerate types:
--   node --env-file=.env.local scripts/gen-db-types.mjs
-- Fails (and changes nothing, it is one transaction) if any NULL has appeared since.
-- Undo: the same statements with "drop not null".
-- waiver_claims.drop_player_id stays nullable on purpose (claims without a drop).
begin;
alter table public.leagues
  alter column commissioner_id set not null,
  alter column max_teams set not null,
  alter column roster_size set not null,
  alter column starters_count set not null,
  alter column season_year set not null,
  alter column current_week set not null,
  alter column draft_status set not null,
  alter column scoring_type set not null,
  alter column created_at set not null;
alter table public.matchups
  alter column league_id set not null,
  alter column team1_id set not null,
  alter column team2_id set not null,
  alter column team1_score set not null,
  alter column team2_score set not null,
  alter column is_final set not null;
alter table public.league_members
  alter column league_id set not null,
  alter column user_id set not null,
  alter column is_commissioner set not null,
  alter column joined_at set not null;
alter table public.rosters
  alter column league_id set not null,
  alter column team_id set not null,
  alter column player_id set not null,
  alter column is_starter set not null,
  alter column acquired_week set not null;
alter table public.drafts
  alter column league_id set not null,
  alter column status set not null,
  alter column type set not null,
  alter column current_pick set not null,
  alter column total_rounds set not null,
  alter column seconds_per_pick set not null;
alter table public.draft_picks
  alter column draft_id set not null,
  alter column team_id set not null,
  alter column player_id set not null,
  alter column picked_at set not null;
alter table public.trades
  alter column league_id set not null,
  alter column proposer_id set not null,
  alter column receiver_id set not null,
  alter column status set not null,
  alter column proposed_at set not null;
alter table public.trade_players
  alter column trade_id set not null,
  alter column player_id set not null,
  alter column from_team_id set not null,
  alter column to_team_id set not null;
alter table public.trade_picks
  alter column trade_id set not null,
  alter column original_team_id set not null,
  alter column from_team_id set not null,
  alter column to_team_id set not null;
alter table public.waiver_claims
  alter column league_id set not null,
  alter column team_id set not null,
  alter column player_id set not null,
  alter column status set not null,
  alter column submitted_at set not null;
alter table public.tournaments
  alter column season_year set not null;
alter table public.tournament_results
  alter column tournament_id set not null,
  alter column player_id set not null,
  alter column fantasy_points set not null;
alter table public.traded_draft_picks
  alter column league_id set not null,
  alter column original_team_id set not null,
  alter column current_team_id set not null;
alter table public.keeper_picks
  alter column league_id set not null,
  alter column team_id set not null,
  alter column player_id set not null;
alter table public.draft_queue
  alter column user_id set not null,
  alter column league_id set not null,
  alter column player_id set not null;
commit;
