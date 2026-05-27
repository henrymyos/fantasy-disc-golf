-- Adds a per-event eagle count so scoring can award a flat bonus per eagle
-- (a hole played 2+ strokes under par) on top of the proportional under-par
-- points. Applied to project cagyuhuzvannojeqkmun.
alter table tournament_results
  add column if not exists eagle_count int not null default 0;
