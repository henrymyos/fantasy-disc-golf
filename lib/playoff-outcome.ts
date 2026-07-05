import type { SupabaseClient } from "@supabase/supabase-js";
import { rankTeams } from "@/lib/standings";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { getLeagueSchedule } from "@/lib/league-schedule";
import { playoffBracketSize, playoffRoundCount, simulatePlayoffs, type Seed, type RoundInput, type PlayoffResult } from "@/lib/playoffs";

export type StandingEntry = {
  teamId: number;
  teamName: string;
  username: string | null;
  wins: number;
  losses: number;
  ties: number;
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
    .select("scoring_mode")
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

  const winsMap: Record<number, { wins: number; losses: number; ties: number; points: number }> = {};
  (members ?? []).forEach((m: any) => { winsMap[m.id] = { wins: 0, losses: 0, ties: 0, points: 0 }; });
  (finals ?? []).forEach((m: any) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, ties: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, ties: 0, points: 0 };
    winsMap[m.team1_id].points += Number(m.team1_score);
    winsMap[m.team2_id].points += Number(m.team2_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) { winsMap[m.team1_id].wins++; winsMap[m.team2_id].losses++; }
      else if (m.team2_score > m.team1_score) { winsMap[m.team2_id].wins++; winsMap[m.team1_id].losses++; }
      else { winsMap[m.team1_id].ties++; winsMap[m.team2_id].ties++; }
    }
  });

  // Canonical league schedule: maps each league week to its selected event /
  // tournament so standings and the bracket score the right events even for a
  // custom subset schedule. Regular weeks drive standings; the bracket also needs
  // playoff-week scores, fetched separately ("all") below.
  const schedule = await getLeagueSchedule(supabase, leagueId);
  const weeklyTotals = await getTeamWeeklyTotals(supabase, leagueId, { weeks: "regular", schedule });
  if (scoringMode !== "head_to_head") {
    const alt = computeAltRecords(weeklyTotals, scoringMode);
    for (const [tid, rec] of alt) {
      if (!winsMap[tid]) winsMap[tid] = { wins: 0, losses: 0, ties: 0, points: 0 };
      winsMap[tid].wins = rec.wins;
      winsMap[tid].losses = rec.losses;
      winsMap[tid].ties = rec.ties;
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
        ties: e.ties,
        points: e.points,
        sos: e.strengthOfSchedule,
      };
    })
    .filter((x): x is StandingEntry => x !== null);

  // Playoff weeks = the league's selected playoff events, in schedule order.
  const playoffWeeks = (schedule?.weeks ?? []).filter((w) => w.isPlayoff);

  // Which playoff-event tournaments have results in yet → "complete".
  const playoffTids = playoffWeeks.flatMap((w) => w.tournamentIds);
  const tidsWithResults = new Set<number>();
  if (playoffTids.length > 0) {
    const { data: resultRows } = await supabase
      .from("tournament_results")
      .select("tournament_id")
      .in("tournament_id", playoffTids);
    for (const r of resultRows ?? []) tidsWithResults.add((r as any).tournament_id);
  }
  const playoffEvents: ResolvedPlayoffEvent[] = playoffWeeks.map((w) => ({
    name: w.event.name,
    week: w.week, // league week index
    complete: w.tournamentIds.some((t) => tidsWithResults.has(t)),
  }));

  // Per-team scores during the playoff weeks, keyed by the same league weeks.
  const weeklyTotalsAll = await getTeamWeeklyTotals(supabase, leagueId, { weeks: "all", schedule });

  // Bracket + simulation.
  const bracketSize = playoffBracketSize(playoffWeeks.length, standings.length);
  const numRounds = playoffRoundCount(bracketSize);
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
    const v = weeklyTotalsAll.get(teamId)?.get(week);
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
