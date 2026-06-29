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
  if (!leagues || leagues.length === 0) {
    return { leaguesChecked: 0, notificationsSent: 0 };
  }
  const leagueIds = leagues.map((l) => (l as any).id as number);

  // Batch the per-member work into a handful of grouped queries instead of two
  // round-trips per member. At ~100 leagues × ~12 members the old shape issued
  // thousands of sequential queries and timed out the 60s cron; this issues a
  // constant number regardless of league/member count.
  const since = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

  const [{ data: members }, { data: starterRows }, { data: recentNotifs }] =
    await Promise.all([
      admin
        .from("league_members")
        .select("id, user_id, team_name, league_id")
        .in("league_id", leagueIds),
      // Pull starter rows with division so we can check per-division fill (a team
      // can have all MPO slots filled but an empty FPO slot — counting the raw
      // total would wrongly treat that lineup as set).
      admin
        .from("rosters")
        .select("league_id, team_id, players(division)")
        .in("league_id", leagueIds)
        .eq("is_starter", true),
      admin
        .from("notifications")
        .select("user_id, league_id")
        .in("league_id", leagueIds)
        .eq("kind", "lineup_unset")
        .gte("created_at", since),
    ]);

  // (leagueId:teamId) -> filled starter counts per division.
  const startersByTeam = new Map<string, { mpo: number; fpo: number }>();
  for (const r of starterRows ?? []) {
    const key = `${(r as any).league_id}:${(r as any).team_id}`;
    const counts = startersByTeam.get(key) ?? { mpo: 0, fpo: 0 };
    if (((r as any).players?.division ?? "MPO") === "FPO") counts.fpo++;
    else counts.mpo++;
    startersByTeam.set(key, counts);
  }

  // (leagueId:userId) already warned inside the dedup window. Mutated as we send
  // so a user with two teams in one league still gets at most one notification
  // per run, matching the original per-(user, league) dedup.
  const notified = new Set<string>();
  for (const n of recentNotifs ?? []) {
    notified.add(`${(n as any).league_id}:${(n as any).user_id}`);
  }

  const membersByLeague = new Map<number, any[]>();
  for (const m of members ?? []) {
    const lid = (m as any).league_id as number;
    const list = membersByLeague.get(lid) ?? [];
    list.push(m);
    membersByLeague.set(lid, list);
  }

  let notificationsSent = 0;
  let leaguesChecked = 0;
  for (const league of leagues) {
    const leagueId = (league as any).id as number;
    leaguesChecked++;
    const mpoSlots = ((league as any).mpo_starters as number) ?? 4;
    const fpoSlots = ((league as any).fpo_starters as number) ?? 2;

    for (const m of membersByLeague.get(leagueId) ?? []) {
      const userId = (m as any).user_id as string | null;
      if (!userId) continue;
      const teamId = (m as any).id as number;

      const counts = startersByTeam.get(`${leagueId}:${teamId}`) ?? { mpo: 0, fpo: 0 };
      const open = Math.max(0, mpoSlots - counts.mpo) + Math.max(0, fpoSlots - counts.fpo);
      if (open === 0) continue;

      // Dedupe: skip if we already notified this user about THIS league
      // recently.
      const dedupKey = `${leagueId}:${userId}`;
      if (notified.has(dedupKey)) continue;

      await enqueueNotification(admin, {
        userId,
        leagueId,
        kind: "lineup_unset",
        body: `${tournamentName} tees off soon and you have ${open} open starter slot${
          open !== 1 ? "s" : ""
        }.`,
        link: `/league/${leagueId}/lineups`,
      });
      notified.add(dedupKey);
      notificationsSent++;
    }
  }

  return { leaguesChecked, notificationsSent };
}
