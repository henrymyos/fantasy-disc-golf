# Session handoff — 2026-05-28

Quick context for resuming after a Claude restart.

## Project basics

- **Repo**: `/Users/henrymyos/Desktop/fantasy-disc-golf`
- **Stack**: Next.js 16.2.1 App Router + Supabase (Postgres + Auth + RLS) + Tailwind v4. PWA-ready. Vercel hosting.
- **Read `AGENTS.md` before writing code**: this version of Next has breaking changes; consult `node_modules/next/dist/docs/` for the relevant guide.
- **Working tree is dirty** with `.next 2/`, `app/api/sync-pdga/route 2.ts`, `scripts/_ranks-backup.json` — all Finder/cache cruft, ignore.
- **Auto memory dir**: `/Users/henrymyos/.claude/projects/-Users-henrymyos-Desktop-fantasy-disc-golf/memory/` — write to it directly if anything cross-session worth remembering surfaces.

## Branch + recent commits

Branch `main`, in sync with origin. Most recent commits:

```
faf48e0 Draft commissioner controls, smarter bots, profile links, panel polish
399ae76 Tournament range picker + player pool grew to 130
b0938b1 Soften dark theme to blue-grey surfaces (Sleeper-like)
09d4ad5 Larger DF in app icons
aeada28 Decimal birdie/bogey/eagle scoring + pre-draft dashboard
b0edd14 Polish/UX: archive, compare, news feed, PWA + push
```

## What's done this session (most recent → older)

- **Draft "Team" picker UX**: tab is just "Team (N)" now; full team dropdown sits inside the panel above the Starters header. Dropdown is `inline-block` so it sizes to the team name, not full row. Lists teams in draft order with pick counts and a check on the selected one.
- **Available-player list sort**: ordered by total fantasy points this season (desc), with rank tiebreakers. Row shows a 1, 2, 3… sequence number rather than the actual points value.
- **Snake-vs-auction dropdown**: replaced the native `<select>` with a styled dropdown matching the time-per-pick `DurationPicker` (`components/draft-type-form.tsx`). Live description text under the checkbox.
- **Third-round reversal**: checkbox under draft type when snake is selected. Default unchecked. Behavior: R1/R2 normal, then **rounds 3+ invert the standard snake direction** (R3 reverse, R4 forward, R5 reverse, R6 forward, …). Implemented in:
  - `lib/snake-order.ts:snakeSlot`
  - `components/draft-board.tsx:isRoundReversed`
  - Postgres `claim_draft_pick` RPC (also persisted in `scripts/2026-05-third-round-reversal.sql`).
  - `actions/draft-config.ts:setDraftConfig` accepts the flag.
  - Schema: `drafts.third_round_reversal boolean default false`.
- **Player pool maintenance**: replaced Kristin Lätt (retired) with Iida Lehtomäki via row-update in place (`scripts/replace-kristin-latt.ts`), added 20 MPO + 10 FPO highest-ranked missing (with alias handling for Richard Wysocki → Ricky Wysocki and an exclude list for retired). Pool now **130 players (90 MPO, 40 FPO)**. Reinterleaved `overall_rank` via `scripts/reinterleave-overall-rank.ts` so divisions are mixed evenly.
- **Tournament range picker on compare page**: From/To dropdowns persist in URL as `?from=&to=` (`components/tournament-range-picker.tsx`). All season totals + per-event head-to-head filter to the window.
- **Type-export hygiene**: moved `NotificationKind` to `lib/notifications.ts` and `PayoutSplit` to `lib/dues-types.ts` so the `"use server"` files in `actions/*` only export async functions.

## Live DB notes

- Supabase project id: `cagyuhuzvannojeqkmun`
- Auth users (admin-listed earlier): `henrymyos@gmail.com` (no league memberships), `henrymyos1@gmail.com` (owns league 4 "Disc Devils"), `henrymyos2@gmail.com`, `paigemyos@gmail.com`.
- League 6 ("New League") has matchups + rosters; league 4 has rosters but no matchups. Use league 6 for live testing once authed.
- Tournament results have been imported through OTB Open (ended 5/24). Northwest Championship (6/4) and later events are loaded with `registered_player_ids` but have no `tournament_results` rows yet.
- Run `npx tsx --env-file=.env.local scripts/run-pdga-import.ts` to refresh results from PDGA.
- Run `npx tsx --env-file=.env.local scripts/simulate-draft.ts` for a self-contained draft simulation (covers snake reversal, autopick, race conditions, etc).

## Open / in-progress

- Nothing currently in flight beyond what's already committed. The most recent change (team picker inside the panel) has been edited externally — file is at HEAD on disk; no uncommitted intent left from me.
- Untracked: `SESSION-HANDOFF.md` (this file), `.next 2/`, `app/api/sync-pdga/route 2.ts` (Finder dup), `scripts/_ranks-backup.json`.

## Conventions I learned

- Server actions live in `actions/*.ts`. They must only export async functions — types belong in `lib/*-types.ts` or matching lib files.
- All write paths against the draft go through the `claim_draft_pick` RPC; never write `rosters` + `draft_picks` directly from JS.
- Migrations get saved as `scripts/2026-05-*.sql` alongside being applied via `mcp__plugin_supabase_supabase__apply_migration`.
- Don't push without explicit asks. Don't commit without explicit asks. Don't run `npm run dev` to "test" — the user runs the dev server themselves.
- Don't sleep/poll for background tasks — the harness re-invokes when ready.

## Picking up

To resume cleanly:
1. `git status` — confirm the cruft is still the only untracked stuff.
2. `npx tsc --noEmit` — should be clean.
3. Skim this file + the most recent 2–3 commit messages for the latest UX decisions.
4. If the user starts a new feature, scan the relevant tile/page first; many features cluster around `app/(app)/league/[id]/draft/`, `lineups`, `matchup`, `matchups`, `settings`.
