-- Migration: make tournaments + tournament_results league-independent.
-- Run this in the Supabase Dashboard → SQL Editor.

-- 1. Drop the league_id column from tournaments.
--    Existing rows keep their data; only the per-league association is removed.
alter table tournaments drop column if exists league_id;

-- 2. Loosen RLS on tournaments: any authenticated user can read.
--    Writes are done via the service_role key from server actions, so we
--    don't need per-user insert/update policies.
drop policy if exists "League members can view tournaments" on tournaments;
drop policy if exists "Commissioners can create tournaments" on tournaments;
create policy "Authenticated users can view tournaments"
  on tournaments for select
  using (auth.uid() is not null);

-- 3. Same treatment for tournament_results.
drop policy if exists "League members can view results" on tournament_results;
drop policy if exists "Commissioners can enter results" on tournament_results;
drop policy if exists "Commissioners can update results" on tournament_results;
create policy "Authenticated users can view results"
  on tournament_results for select
  using (auth.uid() is not null);
