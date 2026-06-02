-- Players' current official PDGA Rating (e.g. 1061), scraped from each player's
-- PDGA profile page by lib/ratings-sync.ts and refreshed by the weekly
-- /api/sync-pdga cron. Nullable: players without a known pdga_number (or whose
-- profile can't be parsed) simply have no rating yet.
alter table public.players
  add column if not exists pdga_rating integer;
