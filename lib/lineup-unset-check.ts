import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification } from "@/lib/notifications";

/**
 * Scans every league for a tournament whose `lock_at` lands within the next
 * `withinHours` window and enqueues a "lineup_unset" notification for any
 * team that hasn't filled all of their starter slots. Idempotent per
 * (user, league, tournament) within a 12-hour window.
 */
export async function runLineupUnsetCheck(
  admin: SupabaseClient,
  withinHours = 6,
): Promise<{ leaguesChecked: number; notificationsSent: number }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

  const { data: upcoming } = await admin
    .from("tournaments")
    .select("id, name, lock_at")
    .not("lock_at", "is", null)
    .gt("lock_at", now.toISOString())
    .lt("lock_at", horizon.toISOString())
    .order("lock_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!upcoming) return { leaguesChecked: 0, notificationsSent: 0 };
  const tournamentName = (upcoming as any).name as string;

  const { data: leagues } = await admin
    .from("leagues")
    .select("id, mpo_starters, fpo_starters");
  let notificationsSent = 0;
  let leaguesChecked = 0;
  for (const league of leagues ?? []) {
    const leagueId = (league as any).id as number;
    leaguesChecked++;
    const mpoSlots = ((league as any).mpo_starters as number) ?? 4;
    const fpoSlots = ((league as any).fpo_starters as number) ?? 2;
    const targetCount = mpoSlots + fpoSlots;

    const { data: members } = await admin
      .from("league_members")
      .select("id, user_id, team_name")
      .eq("league_id", leagueId);

    for (const m of members ?? []) {
      const userId = (m as any).user_id as string | null;
      if (!userId) continue;
      const teamId = (m as any).id as number;

      const { count: starterCount } = await admin
        .from("rosters")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("is_starter", true);
      const filled = starterCount ?? 0;
      if (filled >= targetCount) continue;

      // Dedupe: skip if we already notified this user about THIS league
      // recently.
      const since = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
      const { count: recent } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("league_id", leagueId)
        .eq("kind", "lineup_unset")
        .gte("created_at", since);
      if ((recent ?? 0) > 0) continue;

      await enqueueNotification(admin, {
        userId,
        leagueId,
        kind: "lineup_unset",
        body: `${tournamentName} tees off soon and you have ${
          targetCount - filled
        } open starter slot${targetCount - filled !== 1 ? "s" : ""}.`,
        link: `/league/${leagueId}/lineups`,
      });
      notificationsSent++;
    }
  }

  return { leaguesChecked, notificationsSent };
}
