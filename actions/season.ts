"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { archiveSeason } from "@/actions/archives";

export type RolloverResult = { ok: boolean; message: string; nextYear?: number };

/**
 * Guided "start next season": archives the current season, carries each team's
 * keepers onto fresh rosters, wipes the rest of the season's state (matchups,
 * trades, waivers, draft picks), resets the draft to pending, and bumps the
 * league to the next season year. Commissioner-only and destructive — the UI
 * gates it behind a typed confirmation. Re-running advances another year, so
 * the confirmation matters.
 */
export async function startNextSeason(leagueId: number): Promise<RolloverResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id, commissioner_id, season_year, roster_size, keepers_per_team, name")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) {
    return { ok: false, message: "Not authorized" };
  }

  const currentYear = (league as any).season_year ?? new Date().getUTCFullYear();
  const nextYear = currentYear + 1;
  const keepersPerTeam = (league as any).keepers_per_team ?? 0;
  const rosterSize = (league as any).roster_size ?? 10;

  // 1. Snapshot the season that's ending (idempotent upsert on year).
  await archiveSeason(leagueId);

  // 2. Kept players for the upcoming season.
  const keptByTeam = new Map<number, number[]>();
  if (keepersPerTeam > 0) {
    const { data: keeps } = await admin
      .from("keeper_picks")
      .select("team_id, player_id")
      .eq("league_id", leagueId)
      .eq("season_year", nextYear);
    for (const k of keeps ?? []) {
      const arr = keptByTeam.get((k as any).team_id) ?? [];
      arr.push((k as any).player_id);
      keptByTeam.set((k as any).team_id, arr);
    }
  }

  // 3. The league's draft row(s).
  const { data: drafts } = await admin.from("drafts").select("id").eq("league_id", leagueId).order("id");
  const draftIds = (drafts ?? []).map((d: any) => d.id);
  const keepDraftId = draftIds[0] ?? null;

  // 4. Wipe season state.
  await admin.from("matchups").delete().eq("league_id", leagueId);
  await admin.from("waiver_claims").delete().eq("league_id", leagueId);
  await admin.from("trades").delete().eq("league_id", leagueId);
  await admin.from("rosters").delete().eq("league_id", leagueId);
  await admin.from("traded_draft_picks").delete().eq("league_id", leagueId).eq("season_year", currentYear);
  if (draftIds.length > 0) {
    await admin.from("draft_picks").delete().in("draft_id", draftIds);
    await admin.from("current_draft_pick_owners").delete().in("draft_id", draftIds);
    // Drop any extra draft rows, keeping one to reset.
    const extra = draftIds.slice(1);
    if (extra.length > 0) await admin.from("drafts").delete().in("id", extra);
  }

  // 5. Re-seed kept players onto fresh rosters.
  const rosterRows: any[] = [];
  for (const [teamId, pids] of keptByTeam) {
    for (const pid of pids) {
      rosterRows.push({ league_id: leagueId, team_id: teamId, player_id: pid, is_starter: false, acquired_week: 1 });
    }
  }
  if (rosterRows.length > 0) await admin.from("rosters").insert(rosterRows);

  // 6. Reset the draft to pending. Kept players occupy roster slots, so the new
  //    draft fills the remaining rounds.
  const newRounds = Math.max(1, rosterSize - keepersPerTeam);
  if (keepDraftId != null) {
    await admin
      .from("drafts")
      .update({
        status: "pending",
        current_pick: 1,
        total_rounds: newRounds,
        started_at: null,
        scheduled_at: null,
        current_pick_started_at: null,
        auction_current_player_id: null,
        auction_current_bid: null,
        auction_high_bidder_team_id: null,
        auction_nominator_team_id: null,
        auction_ends_at: null,
      })
      .eq("id", keepDraftId);
  } else {
    await admin.from("drafts").insert({ league_id: leagueId, total_rounds: newRounds });
  }

  // 7. Reset members for a fresh season (keep team name, user, division).
  await admin
    .from("league_members")
    .update({
      dues_paid: false,
      dues_paid_at: null,
      draft_position: null,
      waiver_priority: null,
      auction_budget_remaining: null,
    })
    .eq("league_id", leagueId);

  // 8. Roll the league forward.
  await admin
    .from("leagues")
    .update({
      season_year: nextYear,
      current_week: 1,
      draft_status: null,
      waivers_locked: false,
      selected_event_slugs: null,
    })
    .eq("id", leagueId);

  revalidatePath(`/league/${leagueId}`);
  revalidatePath(`/league/${leagueId}/settings`);
  revalidatePath(`/league/${leagueId}/commish`);
  return { ok: true, message: `Started the ${nextYear} season`, nextYear };
}
