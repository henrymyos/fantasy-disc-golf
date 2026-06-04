-- Per-team ordering of a member's pending waiver claims. Only one claim per
-- team is granted per cycle, so the member can order which one is attempted
-- first. runWaiverProcessing sorts each team's claims by claim_order (then
-- submitted_at); placeWaiverClaim appends to the end; reorderWaiverClaims sets it.
alter table public.waiver_claims add column if not exists claim_order int;
