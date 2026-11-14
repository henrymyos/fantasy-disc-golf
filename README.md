# Fantasy Disc Golf

Season-long fantasy leagues for the Disc Golf Pro Tour. Draft MPO and FPO pros, set a weekly lineup, and score off real tournament results while rounds are being played.

Live: https://fantasy-disc-golf-seven.vercel.app

## Features

- **Drafts:** snake or auction, a live draft room with a pick timer, optional third-round reversal, traded draft picks, bots for empty seats, postpone/resume, and pre-draft reminders (1 day and 1 hour out).
- **Mock drafts:** practice against bots with the league's settings; saved and shareable.
- **Live scoring:** round-by-round fantasy points during tournaments, with per-league scoring rules (placement, birdies, bogeys, eagles, tournament bonuses).
- **Season play:** weekly lineups with lineup lock, head-to-head matchups with projections, standings, playoffs, weekly recaps and a league archive.
- **Roster moves:** trades (players and picks), waivers with claim order, free agency, keepers and a watchlist.
- **Commissioner tools:** league setup, scoring rules, schedule, draft config, members and dues tracking.
- **Social:** league chat with reactions, activity and news feeds, in-app and push notifications.
- **PWA:** installable, with web push.

## Architecture

- **Next.js 16 App Router** (React 19, Tailwind v4). Server components read, server actions in `actions/` write. `proxy.ts` handles auth redirects and public routes.
- **Supabase:** Postgres, Auth and row-level security. Requests run with the user's own session, so RLS applies; cron routes and admin paths use the service-role client in `lib/supabase/admin.ts`.
- **Draft picks are claimed in one Postgres RPC,** `claim_draft_pick`, so two managers (or a manager and the timer) can't take the same pick or pick out of turn. Snake order, including third-round reversal, is computed the same way in `lib/snake-order.ts` and in the RPC.
- **Cron routes** in `app/api/`, each gated by `Authorization: Bearer $CRON_SECRET`:
  - `sync-pdga` (weekly, `vercel.json`): re-imports tournament results, re-sorts the player pool to the latest world rankings and refreshes player ratings.
  - `waiver-cron` (daily, `vercel.json`): processes waiver claims.
  - `draft-cron`: backstop for pick timers. Drafts normally advance from the on-clock browser; this fires any expired timer when nobody has the draft open.
  - `draft-reminders`: sends the 1-day and 1-hour pre-draft reminders (idempotent, safe to run often).
- **Notifications:** web push with VAPID keys (`lib/push.ts`); email through Resend when `RESEND_API_KEY` is set (`lib/notifications.ts`).
- Database types live in `lib/supabase/database.types.ts`; regenerate with `npm run db:types`.

## Live-scoring data flow

1. `lib/pdga-import.ts` fetches each tournament round from PDGA's public live-results endpoint and upserts per-player round scores.
2. `lib/player-points.ts` and `lib/scoring-rules.ts` turn raw scores into fantasy points with each league's scoring rules.
3. `lib/team-scoring.ts` and `lib/gameday.ts` roll player points up into lineups, matchups and standings; `lib/scoring-finalize.ts` and `lib/auto-finalize.ts` lock a week once the event is final.
4. During a live event, logged-in clients poll `/api/refresh-scores`. It runs the same import, limited globally to one PDGA fetch per minute by an atomic claim on the `pdga_import_state` row, so many users or serverless instances never multiply requests to PDGA.

## Run it locally

Needs Node 20+ and a Supabase project (the free tier is fine).

1. `npm ci`
2. In the Supabase SQL editor, run `supabase-schema.sql`, then the files in `scripts/*.sql` in filename (date) order, then `players-seed.sql` for the player pool.
3. Create `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only: crons, admin paths
   CRON_SECRET=<any long random string>
   NEXT_PUBLIC_SITE_URL=http://localhost:3000

   # optional
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=   # push (npx web-push generate-vapid-keys)
   VAPID_PRIVATE_KEY=
   VAPID_SUBJECT=mailto:you@example.com
   RESEND_API_KEY=                 # email notifications
   NOTIFICATION_EMAIL_FROM=
   ADMIN_EMAILS=                   # comma-separated; unlocks /admin
   ```

4. `npm run dev`, open http://localhost:3000 and sign up.
5. Run a cron by hand: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/sync-pdga`

Checks: `npm test` (draft order, playoffs, scoring and standings), `npm run lint`, `npm run build`.

## Stripe dues: off by design

`lib/stripe.ts` can create Checkout sessions for league dues, but everything is gated on `STRIPE_SECRET_KEY`, which is not set. Without it, commissioners track paid/unpaid by hand.

## Docs

- `AGENTS.md`: notes for coding agents (this Next.js version has breaking changes; read `node_modules/next/dist/docs/` first).
- `docs/session-handoff-2026-05.md`: a May 2026 snapshot of work in progress (historical).
