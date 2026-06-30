import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveSelection, getPlayoffSlugs, PLAYOFF_COUNT } from "@/lib/dgpt-2026-schedule";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { regenerateLeagueMatchups } from "@/actions/matchups";

const LOCK_LEAD_MS = 60 * 60 * 1000; // a draft must finish 1h before first tee

/**
 * The instant by which the draft must be complete for an event to be usable as a
 * scoring week: one hour before the event's first tee time. We use the precise
 * PDGA round-1 tee (tournaments.lock_at) once it's posted; until then we fall
 * back to the event's start date at 00:00 UTC — the same day-boundary the lineup
 * lock uses when lock_at is absent.
 */
function eventDeadlineMs(
  tee: { lock_at: string | null; start_date: string | null } | undefined,
  startDate: string,
): number | null {
  const lockAt = tee?.lock_at ?? null;
  if (lockAt) {
    const ms = Date.parse(lockAt);
    if (Number.isFinite(ms)) return ms - LOCK_LEAD_MS;
  }
  const sd = tee?.start_date ?? startDate;
  if (sd) {
    const ms = Date.parse(`${sd}T00:00:00Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * If a draft hasn't finished at least an hour before a selected event's first
 * tee, that event can't be week 1 — drop it from the league's schedule so week 1
 * postpones to the next event. Cascades: any number of leading regular events
 * whose deadline has already passed are dropped, stopping at the first event the
 * draft still beats (which becomes the new week 1). Playoff events are never
 * dropped, and at least one regular event is always kept.
 *
 * No auth — admin client. Called at draft completion (precise, with nowMs = the
 * completion instant) and from the daily cron while a draft is still
 * pending / in progress (a backstop for stalled drafts). Returns the dropped
 * slugs.
 */
export async function applyDraftPostponements(
  admin: SupabaseClient,
  leagueId: number,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const { data: league } = await admin
    .from("leagues")
    .select("selected_event_slugs, season_year")
    .eq("id", leagueId)
    .single();
  if (!league) return [];
  const seasonYear = (league as any).season_year ?? DEFAULT_SEASON_YEAR;

  const events = await getScheduleEvents(admin, seasonYear);
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs, events);
  const selectedSet = new Set(selectedSlugs);
  const playoffSet = new Set(getPlayoffSlugs(selectedSlugs, PLAYOFF_COUNT, events));

  // Selected regular-season events in schedule order.
  const regular = events.filter((e) => selectedSet.has(e.slug) && !playoffSet.has(e.slug));
  if (regular.length <= 1) return []; // always keep at least one regular week

  // First-tee info per event for this season.
  const { data: tournaments } = await admin
    .from("tournaments")
    .select("pdga_event_id, start_date, lock_at")
    .eq("season_year", seasonYear);
  const teeByPdga = new Map<number, { lock_at: string | null; start_date: string | null }>();
  for (const t of tournaments ?? []) {
    if ((t as any).pdga_event_id != null) {
      teeByPdga.set((t as any).pdga_event_id, {
        lock_at: (t as any).lock_at ?? null,
        start_date: (t as any).start_date ?? null,
      });
    }
  }

  // Drop leading regular events whose lock deadline has already passed; stop at
  // the first the draft still beats. Never drop the final regular event.
  const toDrop: string[] = [];
  for (let i = 0; i < regular.length - 1; i++) {
    const e = regular[i];
    const deadline = eventDeadlineMs(
      e.pdgaEventId != null ? teeByPdga.get(e.pdgaEventId) : undefined,
      e.startDate,
    );
    if (deadline != null && deadline < nowMs) {
      toDrop.push(e.slug);
    } else {
      break;
    }
  }
  if (toDrop.length === 0) return [];

  const dropSet = new Set(toDrop);
  const newSelected = selectedSlugs.filter((s) => !dropSet.has(s));
  await admin.from("leagues").update({ selected_event_slugs: newSelected }).eq("id", leagueId);
  return toDrop;
}

/**
 * Run when a draft completes: apply any week-1 postponement (so a late draft
 * doesn't land week 1 on an already-started event), then build the season's
 * matchups against the resulting schedule. Replaces the bare
 * regenerateLeagueMatchups call in every draft-completion path.
 */
export async function finalizeDraftCompletion(
  admin: SupabaseClient,
  leagueId: number,
): Promise<void> {
  await applyDraftPostponements(admin, leagueId);
  await regenerateLeagueMatchups(leagueId);
}
