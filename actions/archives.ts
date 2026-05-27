"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";

/**
 * Commissioner-only: snapshot the current season state (standings + final
 * rosters + completed-draft picks) into season_archives. Idempotent on
 * (league_id, season_year) so re-running overwrites the snapshot.
 */
export async function archiveSeason(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id, season_year, scoring_mode, name")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return;

  const { data: members } = await admin
    .from("league_members")
    .select("id, team_name, user_id")
    .eq("league_id", leagueId)
    .order("joined_at");

  // Compute final standings the same way the dashboard does.
  const scoringMode = ((league as any).scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median";
  const winsMap: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m: any) => {
    winsMap[m.id] = { wins: 0, losses: 0, points: 0 };
  });

  const { data: finalMatchups } = await admin
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score")
    .eq("league_id", leagueId)
    .eq("is_final", true);
  (finalMatchups ?? []).forEach((m: any) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    winsMap[m.team1_id].points += Number(m.team1_score);
    winsMap[m.team2_id].points += Number(m.team2_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) {
        winsMap[m.team1_id].wins++;
        winsMap[m.team2_id].losses++;
      } else if (m.team2_score > m.team1_score) {
        winsMap[m.team2_id].wins++;
        winsMap[m.team1_id].losses++;
      }
    }
  });
  if (scoringMode !== "head_to_head") {
    const weekly = await getTeamWeeklyTotals(admin, leagueId);
    const alt = computeAltRecords(weekly, scoringMode);
    for (const [tid, rec] of alt) {
      if (!winsMap[tid]) winsMap[tid] = { wins: 0, losses: 0, points: 0 };
      winsMap[tid].wins = rec.wins;
      winsMap[tid].losses = rec.losses;
    }
  }

  const standings = (members ?? [])
    .map((m: any) => ({
      teamId: m.id,
      teamName: m.team_name,
      userId: m.user_id ?? null,
      ...winsMap[m.id],
    }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  // Final rosters.
  const { data: rosterRows } = await admin
    .from("rosters")
    .select("team_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", leagueId);
  const rostersByTeam = new Map<number, any[]>();
  for (const r of rosterRows ?? []) {
    const arr = rostersByTeam.get((r as any).team_id) ?? [];
    arr.push({
      name: (r as any).players?.name ?? "Unknown",
      division: (r as any).players?.division ?? "MPO",
      isStarter: !!(r as any).is_starter,
      lineupOrder: (r as any).lineup_order ?? null,
    });
    rostersByTeam.set((r as any).team_id, arr);
  }
  const rosters = standings.map((s) => ({
    teamId: s.teamId,
    teamName: s.teamName,
    players: rostersByTeam.get(s.teamId) ?? [],
  }));

  // Latest completed draft summary, if any.
  const { data: draft } = await admin
    .from("drafts")
    .select("id, type, total_rounds, started_at")
    .eq("league_id", leagueId)
    .eq("status", "complete")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let draftSummary: any = null;
  if (draft) {
    const { data: picks } = await admin
      .from("draft_picks")
      .select("pick_number, round, team_id, players(name, division)")
      .eq("draft_id", (draft as any).id)
      .order("pick_number");
    draftSummary = {
      type: (draft as any).type,
      totalRounds: (draft as any).total_rounds,
      startedAt: (draft as any).started_at,
      picks: (picks ?? []).map((p: any) => ({
        pickNumber: p.pick_number,
        round: p.round,
        teamId: p.team_id,
        playerName: p.players?.name ?? "Unknown",
        division: p.players?.division ?? "MPO",
      })),
    };
  }

  const payload = {
    leagueName: (league as any).name as string,
    scoringMode,
    standings,
    rosters,
    draft: draftSummary,
    snapshotAt: new Date().toISOString(),
  };

  await admin.from("season_archives").upsert(
    {
      league_id: leagueId,
      season_year: (league as any).season_year ?? new Date().getFullYear(),
      payload,
    },
    { onConflict: "league_id,season_year" },
  );

  revalidatePath(`/league/${leagueId}/archive`);
  revalidatePath(`/league/${leagueId}/settings`);
}
