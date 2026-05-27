-- Commissioner power-ups: per-league custom scoring rules + dues tracking.
--
-- scoring_rules shape (nullable, falls back to lib/scoring-constants defaults):
--   {
--     "mpoPositionPoints": {"1": 82, "2": 70, ...} | null,
--     "fpoPositionPoints": {...} | null,
--     "bonusPoints": { "hotRound": 10, "bogeyFree": 5, "ace": 20 }
--   }
--
-- payout_splits shape: [{place:1,pct:60},{place:2,pct:30},{place:3,pct:10}]

alter table public.leagues add column if not exists scoring_rules jsonb;
alter table public.leagues add column if not exists dues_amount numeric;
alter table public.leagues add column if not exists payout_splits jsonb;

alter table public.league_members add column if not exists dues_paid boolean not null default false;
alter table public.league_members add column if not exists dues_paid_at timestamptz;
alter table public.league_members add column if not exists dues_note text;
