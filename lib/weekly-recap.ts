import type { SupabaseClient } from "@supabase/supabase-js";

// Returns a verb keyed to the margin of victory.
function verbForMargin(margin: number): string {
  if (margin <= 5) return "edged";
  if (margin <= 15) return "beat";
  if (margin <= 30) return "rolled past";
  return "demolished";
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
}

/**
 * Builds (and persists) the weekly recap for every finalized matchup in
 * `week`. The body is stored as light markdown the WeeklyRecapCard knows how
 * to render: one `- ` bullet per matchup with `**bold**` team names/scores,
 * then a blank line, then one award per line ("emoji **Name:** value").
 * Idempotent: re-running on the same week refreshes the body in place via the
 * unique (league_id, week) constraint.
 */
export async function generateWeeklyRecap(
  supabase: SupabaseClient,
  leagueId: number,
  week: number,
  tournamentIds: number[] = [],
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

  // The event(s) for this league week are passed in by the finalizer
  // (resolved via the league's selected-event order, not tournaments.week).
  const { data: tournaments } = tournamentIds.length > 0
    ? await supabase.from("tournaments").select("id, name").in("id", tournamentIds)
    : { data: [] as any[] };
  const tournamentNameById = new Map<number, string>(
    (tournaments ?? []).map((t: any) => [t.id, t.name]),
  );

  const teamIds = new Set<number>();
  const teamNameById = new Map<number, string>();
  (matchups ?? []).forEach((m: any) => {
    teamIds.add(m.team1_id);
    teamIds.add(m.team2_id);
    if (m.team1?.team_name) teamNameById.set(m.team1_id, m.team1.team_name);
    if (m.team2?.team_name) teamNameById.set(m.team2_id, m.team2.team_name);
  });

  // Full rosters (starters AND bench) — bench feeds the Bench MVP award.
  const { data: rosterRows } = await supabase
    .from("rosters")
    .select("team_id, player_id, is_starter, players(name)")
    .eq("league_id", leagueId)
    .in("team_id", Array.from(teamIds));

  const playerIds = (rosterRows ?? []).map((s: any) => s.player_id);
  const { data: results } = playerIds.length > 0 && tournamentIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, finishing_position, fantasy_points")
        .in("player_id", playerIds)
        .in("tournament_id", tournamentIds)
    : { data: [] };

  type Performance = {
    name: string;
    teamId: number;
    position: number;
    tournamentName: string;
    points: number;
    isStarter: boolean;
  };
  const performances: Performance[] = [];
  for (const s of rosterRows ?? []) {
    const r = (results ?? []).find((rr: any) => rr.player_id === (s as any).player_id);
    if (!r) continue;
    performances.push({
      name: (s as any).players?.name ?? "Unknown",
      teamId: (s as any).team_id,
      position: Number((r as any).finishing_position ?? 0),
      tournamentName: tournamentNameById.get((r as any).tournament_id) ?? "the event",
      points: Number((r as any).fantasy_points ?? 0),
      isStarter: !!(s as any).is_starter,
    });
  }

  // Each team's top scoring starter, for the matchup-bullet color commentary.
  const topByTeam = new Map<number, Performance>();
  for (const p of performances) {
    if (!p.isStarter) continue;
    const cur = topByTeam.get(p.teamId);
    if (!cur || p.points > cur.points) topByTeam.set(p.teamId, p);
  }

  const finishPhrase = (p: Performance) =>
    p.position === 1 ? `win at ${p.tournamentName}` : `#${p.position} finish at ${p.tournamentName}`;

  // ---- Matchup bullets -----------------------------------------------------
  type Line = {
    winnerId: number | null;
    loserId: number | null;
    margin: number;
    /** Margin as a percentage of the loser's score (Infinity if the loser
     *  scored 0) — ranks Blowout/Closest Call by relative dominance. */
    pctMargin: number;
    text: string;
  };
  const lines: Line[] = [];
  for (const m of matchups as any[]) {
    const t1 = m.team1?.team_name ?? "Team 1";
    const t2 = m.team2?.team_name ?? "Team 2";
    const s1 = Number(m.team1_score);
    const s2 = Number(m.team2_score);

    if (s1 === s2) {
      lines.push({
        winnerId: null,
        loserId: null,
        margin: 0,
        pctMargin: 0,
        text: `**${t1}** and **${t2}** tied **${fmt(s1)}-${fmt(s2)}**.`,
      });
      continue;
    }
    const t1Wins = s1 > s2;
    const winner = t1Wins ? t1 : t2;
    const loser = t1Wins ? t2 : t1;
    const winScore = t1Wins ? s1 : s2;
    const loseScore = t1Wins ? s2 : s1;
    const winnerId = t1Wins ? m.team1_id : m.team2_id;
    const loserId = t1Wins ? m.team2_id : m.team1_id;
    const verb = verbForMargin(Math.abs(s1 - s2));
    const winnerTop = topByTeam.get(winnerId);

    let text = `**${winner}** ${verb} **${loser}** **${fmt(winScore)}-${fmt(loseScore)}**`;
    if (winnerTop && winnerTop.position > 0) {
      text += ` behind ${winnerTop.name}'s ${finishPhrase(winnerTop)}`;
    }
    text += ".";
    const margin = Math.abs(s1 - s2);
    lines.push({
      winnerId,
      loserId,
      margin,
      pctMargin: loseScore > 0 ? (margin / loseScore) * 100 : Infinity,
      text,
    });
  }

  // ---- Awards (Sleeper-style weekly report) --------------------------------
  const teamName = (id: number) => teamNameById.get(id) ?? "Unknown";
  const awards: string[] = [];

  // Team of the Week: highest score anywhere in the round.
  const scored: { teamId: number; score: number; won: boolean }[] = [];
  for (const m of matchups as any[]) {
    const s1 = Number(m.team1_score);
    const s2 = Number(m.team2_score);
    scored.push({ teamId: m.team1_id, score: s1, won: s1 > s2 });
    scored.push({ teamId: m.team2_id, score: s2, won: s2 > s1 });
  }
  const topTeam = [...scored].sort((a, b) => b.score - a.score)[0];
  if (topTeam) {
    awards.push(`🏆 **Team of the Week:** **${teamName(topTeam.teamId)}** — ${fmt(topTeam.score)} pts`);
  }

  // MVP: top-scoring starter league-wide.
  const mvp = [...performances]
    .filter((p) => p.isStarter && p.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  if (mvp) {
    const finish = mvp.position > 0 ? `, ${mvp.position === 1 ? "won" : `#${mvp.position} at`} ${mvp.tournamentName}` : "";
    awards.push(`⭐ **MVP:** ${mvp.name} (${teamName(mvp.teamId)}) — ${fmt(mvp.points)} pts${finish}`);
  }

  // Blowout + Closest Call, ranked by percent margin over the loser rather
  // than raw points so a 20-point win over a 40-point team outranks a
  // 25-point win over a 150-point team. Only meaningful with 2+ decided
  // matchups.
  const decided = lines.filter((l) => l.winnerId != null);
  const byPct = (l: Line) =>
    Number.isFinite(l.pctMargin)
      ? `by ${l.pctMargin < 10 ? l.pctMargin.toFixed(1) : Math.round(l.pctMargin).toString()}%`
      : `by ${fmt(l.margin)} pts`;
  if (decided.length >= 2) {
    const blowout = [...decided].sort((a, b) => b.pctMargin - a.pctMargin)[0];
    const closest = [...decided].sort((a, b) => a.pctMargin - b.pctMargin)[0];
    if (blowout !== closest) {
      awards.push(
        `💥 **Biggest Blowout:** **${teamName(blowout.winnerId!)}** over **${teamName(blowout.loserId!)}** ${byPct(blowout)}`,
      );
      awards.push(
        `😅 **Closest Call:** **${teamName(closest.winnerId!)}** past **${teamName(closest.loserId!)}** ${byPct(closest)}`,
      );
    }
  }

  // Tough Luck: the highest-scoring loser.
  const losers = scored.filter((s) => !s.won && decided.some((l) => l.loserId === s.teamId));
  const toughLuck = [...losers].sort((a, b) => b.score - a.score)[0];
  if (toughLuck && decided.length >= 2) {
    awards.push(`🥶 **Tough Luck:** **${teamName(toughLuck.teamId)}** — ${fmt(toughLuck.score)} pts and still lost`);
  }

  // Bench MVP: best performance left on the bench.
  const benchStar = [...performances]
    .filter((p) => !p.isStarter && p.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  if (benchStar) {
    awards.push(
      `🛋️ **Bench MVP:** ${benchStar.name} (${teamName(benchStar.teamId)}) — ${fmt(benchStar.points)} pts on the bench`,
    );
  }

  // Low Point: lowest score of the round (gentle shaming, Sleeper-style).
  const lowTeam = [...scored].sort((a, b) => a.score - b.score)[0];
  if (lowTeam && scored.length >= 4) {
    awards.push(`🐢 **Low Point:** **${teamName(lowTeam.teamId)}** — ${fmt(lowTeam.score)} pts`);
  }

  const body = [
    ...lines.map((l) => `- ${l.text}`),
    "",
    ...awards,
  ].join("\n");

  await supabase
    .from("weekly_recaps")
    .upsert({ league_id: leagueId, week, body }, { onConflict: "league_id,week" });

  return body;
}
