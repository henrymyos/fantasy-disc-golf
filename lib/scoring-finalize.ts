import type { SupabaseClient } from "@supabase/supabase-js";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";
import { generateWeeklyRecap } from "@/lib/weekly-recap";
import { enqueueNotification } from "@/lib/notifications";
import { cappedStarterIds, type StarterRow } from "@/lib/lineup-slots";
import { DEFAULT_SEASON_YEAR, getScheduleEvents } from "@/lib/schedule";
import { buildSeasonSchedule } from "@/lib/matchup-scheduler";
import { effectiveSelection } from "@/lib/dgpt-2026-schedule";
import { regularSeasonWeekCount } from "@/lib/season-weeks";
import { getLeagueSchedule } from "@/lib/league-schedule";
import { applyLineupPlansForWeek, getLineupSnapshot, type PlannedStarter } from "@/lib/lineup-plans";

/** Round-robin pairing for a given week (used when next week's matchups don't
 *  already exist). */
export function generateMatchups(teamIds: number[], week: number): [number, number][] {
  const pairs: [number, number][] = [];
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(-1);
  const half = teams.length / 2;
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const shift = (week - 1) % rotating.length;
  const newRotating = [...rotating.slice(shift), ...rotating.slice(0, shift)];
  const schedule = [fixed, ...newRotating];
  for (let i = 0; i < half; i++) {
    const t1 = schedule[i];
    const t2 = schedule[schedule.length - 1 - i];
    if (t1 !== -1 && t2 !== -1) pairs.push([t1, t2]);
  }
  return pairs;
}

/**
 * Computes each team's score for `week` under the league's rules, writes the
 * matchup results (is_final), generates the recap, and notifies owners. No
 * auth — callers (the commissioner action or the auto-finalize cron) must gate
 * appropriately. Uses the service-role `admin` client.
 */
export async function finalizeWeekScoresCore(
  admin: SupabaseClient,
  leagueId: number,
  week: number,
  opts: { notify?: boolean; recap?: boolean } = {},
): Promise<void> {
  const notify = opts.notify ?? true;
  const recap = opts.recap ?? true;
  const { data: league } = await admin
    .from("leagues")
    .select("scoring_rules, mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  const rules = resolveScoringRules((league as any)?.scoring_rules);
  const mpoSlots = (league as any)?.mpo_starters ?? 4;
  const fpoSlots = (league as any)?.fpo_starters ?? 2;

  // Map this LEAGUE week to the event it represents (the league's Nth selected
  // event), then to that event's tournament(s). Keying on the league's
  // selected-event order — not the global tournaments.week — is what makes a
  // custom/subset schedule score the right event for each week.
  const schedule = await getLeagueSchedule(admin, leagueId);
  const tournamentIds = schedule?.weekToTournamentIds.get(week) ?? [];
  if (tournamentIds.length === 0) return;

  const { data: results } = await admin
    .from("tournament_results")
    .select("player_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
    .in("tournament_id", tournamentIds);

  const playerPoints: Record<number, number> = {};
  (results ?? []).forEach((r: any) => {
    const pts = fantasyPointsFromResult(rules, {
      finishing_position: r.finishing_position,
      hot_round_count: r.hot_round_count,
      bogey_free_count: r.bogey_free_count,
      ace_count: r.ace_count,
      under_par_strokes: r.under_par_strokes,
      over_par_strokes: r.over_par_strokes,
      eagle_count: r.eagle_count,
      division: r.players?.division ?? "MPO",
    });
    playerPoints[r.player_id] = (playerPoints[r.player_id] ?? 0) + pts;
  });

  const { data: rosterRows } = await admin
    .from("rosters")
    .select("team_id, player_id, is_starter, lineup_order, players(division)")
    .eq("league_id", leagueId);

  // Cap each team to its configured division slots (lowest lineup_order first)
  // so the official score matches the lineup the UI shows, not every starter row.
  const rowsByTeam = new Map<number, StarterRow[]>();
  const allByTeam = new Map<number, Array<{ player_id: number; division: string }>>();
  (rosterRows ?? []).forEach((s: any) => {
    const division = s.players?.division ?? "MPO";
    if (s.is_starter) {
      const list = rowsByTeam.get(s.team_id) ?? [];
      list.push({ player_id: s.player_id, division, lineup_order: s.lineup_order ?? null });
      rowsByTeam.set(s.team_id, list);
    }
    const all = allByTeam.get(s.team_id) ?? [];
    all.push({ player_id: s.player_id, division });
    allByTeam.set(s.team_id, all);
  });

  // RE-finalizing a week that already has a snapshot scores the lineup that was
  // actually in place that week, not today's roster. Without this, re-running a
  // past week (the /api/refinalize maintenance route, or a commissioner
  // correcting results) rescored it with whatever trades and waiver claims have
  // happened since and silently rewrote history. The FIRST finalize has no
  // snapshot yet, so it uses the live roster as before.
  const teamScores: Record<number, number> = {};
  const starterIdsByTeam = new Map<number, number[]>();
  const teamIds = new Set<number>([...rowsByTeam.keys(), ...allByTeam.keys()]);
  const scoredFromSnapshot = new Set<number>();
  for (const teamId of teamIds) {
    const snapshot = await getLineupSnapshot(admin, leagueId, teamId, week);
    if (snapshot) scoredFromSnapshot.add(teamId);
    const ids = snapshot
      ? snapshot.starters.map((s) => s.player_id)
      : cappedStarterIds(rowsByTeam.get(teamId) ?? [], mpoSlots, fpoSlots);
    starterIdsByTeam.set(teamId, ids);
    let sum = 0;
    for (const pid of ids) sum += playerPoints[pid] ?? 0;
    teamScores[teamId] = sum;
  }

  // Record each team's scored lineup so past-week views can show the real
  // historical lineup after rosters change. Best-effort: the table may not
  // exist until the 2026-08 migration runs.
  try {
    for (const [teamId, all] of allByTeam) {
      // Already have the historical lineup for this team — leave it alone
      // rather than rewriting its bench from today's roster.
      if (scoredFromSnapshot.has(teamId)) continue;
      const ids = starterIdsByTeam.get(teamId) ?? [];
      const idSet = new Set(ids);
      const divByPlayer = new Map(all.map((p) => [p.player_id, p.division]));
      const perDivCount: Record<string, number> = {};
      const starters: PlannedStarter[] = ids.map((pid) => {
        const slot = (divByPlayer.get(pid) === "FPO" ? "FPO" : "MPO") as "MPO" | "FPO";
        perDivCount[slot] = (perDivCount[slot] ?? 0) + 1;
        return { player_id: pid, slot, order: perDivCount[slot] };
      });
      const bench = all.map((p) => p.player_id).filter((pid) => !idSet.has(pid));
      await admin.from("lineup_snapshots").upsert(
        { league_id: leagueId, team_id: teamId, week, lineup: { starters, bench } },
        { onConflict: "league_id,team_id,week" },
      );
    }
  } catch {
    // snapshots are a nice-to-have; never block finalize on them
  }

  const { data: matchups } = await admin
    .from("matchups")
    .select("id, team1_id, team2_id")
    .eq("league_id", leagueId)
    .eq("week", week);

  for (const m of matchups ?? []) {
    await admin.from("matchups").update({
      team1_score: teamScores[(m as any).team1_id] ?? 0,
      team2_score: teamScores[(m as any).team2_id] ?? 0,
      is_final: true,
      finalized_at: new Date().toISOString(),
    }).eq("id", (m as any).id);
  }

  if (recap) await generateWeeklyRecap(admin, leagueId, week, tournamentIds);

  if (!notify) return;

  const { data: teamMembers } = await admin
    .from("league_members")
    .select("id, team_name, user_id")
    .eq("league_id", leagueId);
  const teamUserMap = new Map<number, string | null>(
    (teamMembers ?? []).map((m: any) => [m.id, m.user_id ?? null]),
  );
  const nameById = new Map<number, string>(
    (teamMembers ?? []).map((m: any) => [m.id, m.team_name as string]),
  );

  for (const m of matchups ?? []) {
    const s1 = teamScores[(m as any).team1_id] ?? 0;
    const s2 = teamScores[(m as any).team2_id] ?? 0;
    const u1 = teamUserMap.get((m as any).team1_id);
    const u2 = teamUserMap.get((m as any).team2_id);
    const t1Name = nameById.get((m as any).team1_id) ?? "Team 1";
    const t2Name = nameById.get((m as any).team2_id) ?? "Team 2";
    const link = `/league/${leagueId}/matchups/${(m as any).id}`;
    if (u1) {
      const verdict = s1 === s2 ? "tied with" : s1 > s2 ? "won against" : "lost to";
      await enqueueNotification(admin, {
        userId: u1,
        leagueId,
        kind: "weekly_result",
        body: `Week ${week}: you ${verdict} ${t2Name} ${s1.toFixed(1)}-${s2.toFixed(1)}.`,
        link,
      });
    }
    if (u2) {
      const verdict = s2 === s1 ? "tied with" : s2 > s1 ? "won against" : "lost to";
      await enqueueNotification(admin, {
        userId: u2,
        leagueId,
        kind: "weekly_result",
        body: `Week ${week}: you ${verdict} ${t1Name} ${s2.toFixed(1)}-${s1.toFixed(1)}.`,
        link,
      });
    }
  }
}

/** Advances the league to the next week, creating its matchups if missing. */
export async function advanceWeekCore(admin: SupabaseClient, leagueId: number): Promise<void> {
  const { data: league } = await admin
    .from("leagues")
    .select("current_week, selected_event_slugs, season_year, max_teams, mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  if (!league) return;
  const nextWeek = (league as any).current_week + 1;

  const { data: members } = await admin
    .from("league_members")
    .select("id, division_name")
    .eq("league_id", leagueId)
    .order("joined_at");
  if (!members || members.length < 2) return;

  // Only create matchups during the REGULAR season. Past it (the playoff-event
  // weeks), results drive the bracket, not standings — generating and then
  // finalizing round-robin matchups there double-counts those events into the
  // records and corrupts seeding.
  const events = await getScheduleEvents(admin, (league as any).season_year ?? DEFAULT_SEASON_YEAR);
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs, events);
  const regularWeeks = regularSeasonWeekCount(selectedSlugs, events, (league as any).max_teams);

  if (nextWeek <= regularWeeks) {
    const { count: existing } = await admin
      .from("matchups")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("week", nextWeek);
    if ((existing ?? 0) === 0) {
      // Division-aware pairing for this week, matching regenerateLeagueMatchups.
      const schedule = buildSeasonSchedule(
        members.map((m: any) => ({ id: m.id, divisionName: m.division_name })),
        nextWeek,
      );
      const wk = schedule.find((s) => s.week === nextWeek);
      if (wk && wk.pairs.length > 0) {
        await admin.from("matchups").insert(
          wk.pairs.map(([t1, t2]) => ({
            league_id: leagueId,
            week: nextWeek,
            team1_id: t1,
            team2_id: t2,
            team1_score: 0,
            team2_score: 0,
            is_final: false,
          })),
        );
      }
    }
  }

  await admin.from("leagues").update({ current_week: nextWeek }).eq("id", leagueId);

  // The new week's staged lineups (set from the Team page's week switcher)
  // become the live lineups now.
  await applyLineupPlansForWeek(
    admin,
    leagueId,
    nextWeek,
    (league as any).mpo_starters ?? 4,
    (league as any).fpo_starters ?? 2,
  );
}
