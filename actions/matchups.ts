"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSeasonSchedule } from "@/lib/matchup-scheduler";
import { effectiveSelection, getPlayoffSlugs, PLAYOFF_COUNT, type DgptEvent } from "@/lib/dgpt-2026-schedule";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";

function regularSeasonWeekCount(selectedSlugs: string[], events: DgptEvent[]): number {
  // Total selected events minus the playoff slate at the end. Fall back to 14
  // weeks if the selection looks empty so users always get a schedule.
  if (!selectedSlugs || selectedSlugs.length === 0) return 14;
  const playoffs = new Set(getPlayoffSlugs(selectedSlugs, PLAYOFF_COUNT, events));
  return Math.max(1, selectedSlugs.length - playoffs.size);
}

/** Core scheduler called both from server actions and on draft completion.
 *  Wipes any future (non-final) matchups and rebuilds them via round-robin
 *  for every regular-season week. */
export async function regenerateLeagueMatchups(leagueId: number): Promise<void> {
  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("selected_event_slugs, current_week, season_year")
    .eq("id", leagueId)
    .single();
  if (!league) return;

  const { data: members } = await admin
    .from("league_members")
    .select("id, division_name")
    .eq("league_id", leagueId)
    .order("joined_at");
  if (!members || members.length < 2) return;

  const events = await getScheduleEvents(admin, (league as any).season_year ?? DEFAULT_SEASON_YEAR);
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs, events);
  const totalWeeks = regularSeasonWeekCount(selectedSlugs, events);
  const schedule = buildSeasonSchedule(
    members.map((m: any) => ({ id: m.id, divisionName: m.division_name })),
    totalWeeks,
  );

  // Preserve finalized matchups; wipe everything else.
  await admin
    .from("matchups")
    .delete()
    .eq("league_id", leagueId)
    .eq("is_final", false);

  const rows = schedule.flatMap(({ week, pairs }) =>
    pairs.map(([t1, t2]) => ({
      league_id: leagueId,
      week,
      team1_id: t1,
      team2_id: t2,
      team1_score: 0,
      team2_score: 0,
      is_final: false,
    })),
  );

  if (rows.length > 0) {
    await admin.from("matchups").insert(rows);
  }
}

/** Commissioner-only wrapper. */
export async function regenerateMatchupsAction(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  await regenerateLeagueMatchups(leagueId);

  revalidatePath(`/league/${leagueId}`);
  revalidatePath(`/league/${leagueId}/matchups`);
  revalidatePath(`/league/${leagueId}/settings/matchups`);
}

/** Update which two teams play in a given matchup. Commissioner-only and only
 *  before the matchup is finalized. */
export async function updateMatchupTeams(
  leagueId: number,
  matchupId: number,
  team1Id: number,
  team2Id: number,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (team1Id === team2Id) return;

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: matchup } = await admin
    .from("matchups")
    .select("id, league_id, is_final")
    .eq("id", matchupId)
    .single();
  if (!matchup || matchup.league_id !== leagueId || (matchup as any).is_final) return;

  await admin
    .from("matchups")
    .update({ team1_id: team1Id, team2_id: team2Id })
    .eq("id", matchupId);

  revalidatePath(`/league/${leagueId}`);
  revalidatePath(`/league/${leagueId}/matchups`);
  revalidatePath(`/league/${leagueId}/settings/matchups`);
}

/** Set or clear a team's division. Commissioner-only. */
export async function setMemberDivision(
  leagueId: number,
  memberId: number,
  divisionName: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const cleaned = divisionName ? divisionName.trim().slice(0, 30) : null;
  await admin
    .from("league_members")
    .update({ division_name: cleaned })
    .eq("id", memberId)
    .eq("league_id", leagueId);

  revalidatePath(`/league/${leagueId}/settings`);
}
