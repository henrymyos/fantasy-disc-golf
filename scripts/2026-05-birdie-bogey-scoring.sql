-- Adds per-event birdie/bogey tracking (relative to par) so scoring can award
-- +0.2 per stroke under par and -0.1 per stroke over par. Counts are cumulative
-- strokes across all of the player's rounds in the event (eagles/double-bogeys
-- contribute proportionally). Applied to project cagyuhuzvannojeqkmun.
alter table tournament_results
  add column if not exists under_par_strokes int not null default 0,
  add column if not exists over_par_strokes int not null default 0;
