-- Default per-pick timer for new drafts is now 1 minute (was 90 seconds).
-- Existing rows are not touched. The action also widens the allowed range to
-- 10 seconds .. 7 days to support slow async drafts.
alter table drafts alter column seconds_per_pick set default 60;
