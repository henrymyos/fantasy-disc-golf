import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveSelection, getPlayoffSlugs, PLAYOFF_COUNT, type DgptEvent } from "@/lib/dgpt-2026-schedule";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { rankTeams } from "@/lib/standings";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { playoffBracketSize, simulatePlayoffs, type Seed, type RoundInput, type PlayoffResult } from "@/lib/playoffs";

export type StandingEntry = {
  teamId: number;
  teamName: string;
  username: string | null;
  wins: number;
  losses: number;
  points: number;
  sos: number;
};

export type ResolvedPlayoffEvent = { name: string; week: number | null; complete: boolean };

export type PlayoffOutcome = {
  standings: StandingEntry[];
  bracketSize: number;
  seeds: Seed[];
  playoffEvents: ResolvedPlayoffEvent[];
  result: PlayoffResult;
  championTeamId: number | null;
  /** Champion resolved to a standing, falling back to the #1 seed only when no
   *  playoff bracket exists at all (no playoff events selected). */
  champion: StandingEntry | null;
  consolationChamp: StandingEntry | null;
  lastPlace: StandingEntry | null;
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Computes final standings and runs the playoff bracket from real weekly scores
 * during the playoff events. Shared by the playoffs page and the season review
 * so they always agree on who won.
 */
export async function getPlayoffOutcome(
  supabase: SupabaseClient,
  leagueId: number,
): Promise<PlayoffOutcome> {
  const { data: league } = await supabase
    .from("leagues")
    .select("scoring_mode, selected_event_slugs, season_year")
    .eq("id", leagueId)
    .single();
  const scoringMode = (((league as any)?.scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, profiles(username)")
    .eq("league_id", leagueId);

  const { data: finals } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score")
    .eq("league_id", leagueId)
    .eq("is_final", true);

  const winsMap: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m: any) => { winsMap[m.id] = { wins: 0, losses: 0, points: 0 }; });
  (finals ?? []).forEach((m: any) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    winsMap[m.team1_id].points += Number(m.team1_score);
    winsMap[m.team2_id].points += Number(m.team2_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) { winsMap[m.team1_id].wins++; winsMap[m.team2_id].losses++; }
      else if (m.team2_score > m.team1_score) { winsMap[m.team2_id].wins++; winsMap[m.team1_id].losses++; }
    }
  });

  const weeklyTotals = await getTeamWeeklyTotals(supabase, leagueId);
  if (scoringMode !== "head_to_head") {
    const alt = computeAltRecords(weeklyTotals, scoringMode);
    for (const [tid, rec] of alt) {
      if (!winsMap[tid]) winsMap[tid] = { wins: 0, losses: 0, points: 0 };
      winsMap[tid].wins = rec.wins;
      winsMap[tid].losses = rec.losses;
      if (winsMap[tid].points === 0) {
        let sum = 0;
        for (const v of (weeklyTotals.get(tid)?.values() ?? [])) sum += v;
        winsMap[tid].points = sum;
      }
    }
  }

  const ranked = rankTeams(winsMap, (finals ?? []) as any, { headToHead: scoringMode === "head_to_head" });
  const memberById = new Map((members ?? []).map((m: any) => [m.id, m]));
  const standings: StandingEntry[] = ranked
    .map((e) => {
      const m = memberById.get(e.teamId);
      if (!m) return null;
      return {
        teamId: e.teamId,
        teamName: (m as any).team_name as string,
        username: ((m as any).profiles as any)?.username ?? null,
        wins: e.wins,
        losses: e.losses,
        points: e.points,
        sos: e.strengthOfSchedule,
      };
    })
    .filter((x): x is StandingEntry => x !== null);

  // Playoff events (last N selected), earliest → latest.
  const events = await getScheduleEvents(supabase, (league as any)?.season_year ?? DEFAULT_SEASON_YEAR);
  const selectedSlugs = effectiveSelection((league as any)?.selected_event_slugs, events);
  const playoffSlugs = getPlayoffSlugs(selectedSlugs, PLAYOFF_COUNT, events);
  const playoffSchedule: DgptEvent[] = events
    .filter((e) => playoffSlugs.includes(e.slug))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Map each playoff event to a tournament week + whether results are in.
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, week, pdga_event_id, name");
  const { data: resultRows } = await supabase
    .from("tournament_results")
    .select("tournament_id");
  const tournamentsWithResults = new Set<number>((resultRows ?? []).map((r: any) => r.tournament_id));
  const weekHasResults = new Set<number>();
  const byPdga = new Map<number, { week: number; id: number }>();
  const byName = new Map<string, { week: number; id: number }>();
  (tournaments ?? []).forEach((t: any) => {
    if (t.pdga_event_id != null) byPdga.set(t.pdga_event_id, { week: t.week, id: t.id });
    if (t.name) byName.set(normalizeName(t.name), { week: t.week, id: t.id });
    if (tournamentsWithResults.has(t.id)) weekHasResults.add(t.week);
  });
  const resolveEvent = (e: DgptEvent): { week: number | null; complete: boolean; name: string } => {
    const hit = (e.pdgaEventId != null ? byPdga.get(e.pdgaEventId) : undefined) ?? byName.get(normalizeName(e.name));
    const week = hit?.week ?? null;
    return { week, complete: week != null && weekHasResults.has(week), name: e.name };
  };
  const playoffEvents: ResolvedPlayoffEvent[] = playoffSchedule.map(resolveEvent);

  // Bracket + simulation.
  const bracketSize = playoffBracketSize(playoffSchedule.length, standings.length);
  const numRounds = bracketSize >= 2 ? Math.log2(bracketSize) : 0;
  const seeds: Seed[] = standings.slice(0, bracketSize).map((s, i) => ({
    teamId: s.teamId,
    teamName: s.teamName,
    username: s.username,
    seed: i + 1,
  }));
  // Use the last `numRounds` playoff events so the championship is the final event.
  const roundsInput: RoundInput[] = playoffEvents
    .slice(Math.max(0, playoffEvents.length - numRounds))
    .map((e) => ({ name: e.name, week: e.week, complete: e.complete }));

  const scoreFor = (teamId: number, week: number | null): number | null => {
    if (week == null) return null;
    const v = weeklyTotals.get(teamId)?.get(week);
    return v == null ? null : v;
  };

  const result = numRounds >= 1
    ? simulatePlayoffs(seeds, roundsInput, scoreFor)
    : { rounds: [], championTeamId: null };

  const byId = new Map(standings.map((s) => [s.teamId, s]));
  const champion =
    result.championTeamId != null
      ? byId.get(result.championTeamId) ?? null
      : bracketSize < 2
        ? standings[0] ?? null // no bracket possible — fall back to regular-season #1
        : null;
  const consolationChamp = bracketSize >= 2 && bracketSize < standings.length ? standings[bracketSize] : null;
  const lastPlace = standings.length > 1 ? standings[standings.length - 1] : null;

  return {
    standings,
    bracketSize,
    seeds,
    playoffEvents,
    result,
    championTeamId: result.championTeamId,
    champion,
    consolationChamp,
    lastPlace,
  };
}
