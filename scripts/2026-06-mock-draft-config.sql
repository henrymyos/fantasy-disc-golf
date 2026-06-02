-- Mock drafts mirror the league's real draft configuration so a mock can run
-- as either a snake or an auction draft. These columns capture the config the
-- mock was run under (snapshotted at creation), independent of later changes
-- to the live draft.
alter table public.mock_drafts
  add column if not exists draft_type text not null default 'snake'
    check (draft_type in ('snake', 'auction')),
  add column if not exists auction_budget integer,
  add column if not exists third_round_reversal boolean not null default false;
