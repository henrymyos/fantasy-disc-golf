import type { SupabaseClient } from "@supabase/supabase-js";
import { cappedStarterIds, type StarterRow } from "@/lib/lineup-slots";
import { getLeagueNextTournamentId, getLeagueSchedule } from "@/lib/league-schedule";

export type LineupIssues = {
  /** Slot-capped starters not registered for the current week's event. */
  outNames: string[];
  emptySlots: number;
  eventName: string | null;
};

/**
 * Problems with a team's lineup for the league's CURRENT week: starters who
 * are OUT for that week's event (not on its registration list) and unfilled
 * starter slots. Returns null when the lineup is clean or the roster is empty.
 * Powers the Sleeper-style red alert on the league home, Team page, and the
 * mobile bottom nav badge.
 */
export async function getLineupIssues(
  supabase: SupabaseClient,
  leagueId: number,
  teamId: number,
): Promise<LineupIssues | null> {
  const { data: league } = await supabase
    .from("leagues")
    .select("current_week, mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  if (!league) return null;
  const mpoSlots = (league as any).mpo_starters ?? 4;
  const fpoSlots = (league as any).fpo_starters ?? 2;

  const schedule = await getLeagueSchedule(supabase, leagueId);
  const currentWeekTid: number | null =
    schedule?.weekToTournamentIds.get((league as any).current_week)?.[0]
    ?? (await getLeagueNextTournamentId(supabase, leagueId));
  let regSet: Set<number> | null = null;
  let eventName: string | null =
    schedule?.weeks.find((w) => w.week === (league as any).current_week)?.event.name ?? null;
  if (currentWeekTid != null) {
    const { data: tRow } = await supabase
      .from("tournaments")
      .select("name, registered_player_ids")
      .eq("id", currentWeekTid)
      .maybeSingle();
    const ids = (tRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) regSet = new Set(ids);
    eventName = (tRow as any)?.name ?? eventName;
  }

  const { data: rosterRows } = await supabase
    .from("rosters")
    .select("player_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", leagueId)
    .eq("team_id", teamId);
  if (!rosterRows || rosterRows.length === 0) return null;

  const starterRows: StarterRow[] = rosterRows
    .filter((r: any) => r.is_starter)
    .map((r: any) => ({
      player_id: r.player_id,
      division: r.players?.division ?? "MPO",
      lineup_order: r.lineup_order ?? null,
    }));
  const cappedIds = cappedStarterIds(starterRows, mpoSlots, fpoSlots);
  const nameByPlayer = new Map<number, string>(
    rosterRows.map((r: any) => [r.player_id as number, (r.players?.name as string) ?? "Unknown"]),
  );

  const emptySlots = Math.max(0, mpoSlots + fpoSlots - cappedIds.length);
  const outNames =
    regSet != null
      ? cappedIds.filter((pid) => !regSet!.has(pid)).map((pid) => nameByPlayer.get(pid) ?? "Unknown")
      : [];

  if (emptySlots === 0 && outNames.length === 0) return null;
  return { outNames, emptySlots, eventName };
}
