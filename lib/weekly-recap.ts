import type { SupabaseClient } from "@supabase/supabase-js";

// Returns a verb keyed to the margin of victory.
function verbForMargin(margin: number): string {
  if (margin <= 5) return "edged";
  if (margin <= 15) return "beat";
  if (margin <= 30) return "rolled past";
  return "demolished";
}

/**
 * Builds (and persists) a templated paragraph summarizing every finalized
 * matchup for `week`. Idempotent: re-running on the same week refreshes the
 * body in place via the unique (league_id, week) constraint.
 */
export async function generateWeeklyRecap(
  supabase: SupabaseClient,
  leagueId: number,
  week: number,
): Promise<string | null> {
  const { data: matchups } = await supabase
    .from("matchups")
    .select(
      "id, team1_id, team2_id, team1_score, team2_score, is_final, team1:league_members!matchups_team1_id_fkey(team_name), team2:league_members!matchups_team2_id_fkey(team_name)",
    )
    .eq("league_id", leagueId)
    .eq("week", week)
    .eq("is_final", true);
  if (!matchups || matchups.length === 0) return null;

  // Top starter for each team in this week's event(s) — used to season the
  // sentences with a "on the back of X's win at Tournament" clause.
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("week", week);
  const tournamentIds = (tournaments ?? []).map((t: any) => t.id);
  const tournamentNameById = new Map<number, string>(
    (tournaments ?? []).map((t: any) => [t.id, t.name]),
  );

  const teamIds = new Set<number>();
  (matchups ?? []).forEach((m: any) => {
    teamIds.add(m.team1_id);
    teamIds.add(m.team2_id);
  });

  const { data: starters } = await supabase
    .from("rosters")
    .select("team_id, player_id, players(name)")
    .eq("league_id", leagueId)
    .eq("is_starter", true)
    .in("team_id", Array.from(teamIds));

  const playerIds = (starters ?? []).map((s: any) => s.player_id);
  const { data: results } = playerIds.length > 0 && tournamentIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, finishing_position, fantasy_points")
        .in("player_id", playerIds)
        .in("tournament_id", tournamentIds)
    : { data: [] };

  // Pick each team's top scoring starter.
  const topByTeam = new Map<number, { name: string; position: number; tournamentName: string; points: number }>();
  for (const team_id of teamIds) {
    const teamStarters = (starters ?? []).filter((s: any) => s.team_id === team_id);
    let best: { name: string; position: number; tournamentName: string; points: number } | null = null;
    for (const s of teamStarters) {
      const r = (results ?? []).find((rr: any) => rr.player_id === s.player_id);
      if (!r) continue;
      const points = Number((r as any).fantasy_points ?? 0);
      if (!best || points > best.points) {
        best = {
          name: (s as any).players?.name ?? "Unknown",
          position: Number((r as any).finishing_position ?? 0),
          tournamentName: tournamentNameById.get((r as any).tournament_id) ?? "the event",
          points,
        };
      }
    }
    if (best) topByTeam.set(team_id, best);
  }

  const sentences: string[] = [];
  for (const m of matchups as any[]) {
    const t1 = m.team1?.team_name ?? "Team 1";
    const t2 = m.team2?.team_name ?? "Team 2";
    const s1 = Number(m.team1_score);
    const s2 = Number(m.team2_score);

    if (s1 === s2) {
      sentences.push(`${t1} and ${t2} tied ${s1.toFixed(1)}-${s2.toFixed(1)}.`);
      continue;
    }
    const t1Wins = s1 > s2;
    const winner = t1Wins ? t1 : t2;
    const loser = t1Wins ? t2 : t1;
    const winScore = t1Wins ? s1 : s2;
    const loseScore = t1Wins ? s2 : s1;
    const verb = verbForMargin(Math.abs(s1 - s2));
    const winnerTeamId = t1Wins ? m.team1_id : m.team2_id;
    const winnerTop = topByTeam.get(winnerTeamId);

    const winFmt = Number.isInteger(winScore) ? winScore.toFixed(0) : winScore.toFixed(1);
    const loseFmt = Number.isInteger(loseScore) ? loseScore.toFixed(0) : loseScore.toFixed(1);
    let sentence = `${winner} ${verb} ${loser} ${winFmt}-${loseFmt}`;
    if (winnerTop && winnerTop.position > 0) {
      const finishWord = winnerTop.position === 1
        ? "win"
        : `#${winnerTop.position} finish`;
      sentence += ` on the back of ${winnerTop.name}'s ${finishWord} at ${winnerTop.tournamentName}`;
    }
    sentence += ".";
    sentences.push(sentence);
  }

  const body = sentences.join(" ");

  await supabase
    .from("weekly_recaps")
    .upsert({ league_id: leagueId, week, body }, { onConflict: "league_id,week" });

  return body;
}
