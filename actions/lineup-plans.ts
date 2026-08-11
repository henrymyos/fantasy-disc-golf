"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlannedStarter } from "@/lib/lineup-plans";

/**
 * Saves the caller's staged lineup for a FUTURE league week (replacing any
 * existing plan for that week). Unlike live-lineup edits this is never
 * lineup-locked — planning next week during a live event is the whole point.
 * The plan is applied to the real roster when the week becomes current
 * (applyLineupPlansForWeek in advanceWeekCore).
 */
export async function saveWeekLineupPlan(
  leagueId: number,
  week: number,
  starters: PlannedStarter[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!Number.isInteger(week) || week < 1) return { ok: false, error: "Bad week" };

  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("current_week, mpo_starters, fpo_starters")
    .eq("id", leagueId)
    .single();
  if (!league) return { ok: false, error: "League not found" };
  if (week <= (league as any).current_week) {
    return { ok: false, error: "Only future weeks can be planned" };
  }
  const mpoSlots = (league as any).mpo_starters ?? 4;
  const fpoSlots = (league as any).fpo_starters ?? 2;

  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) return { ok: false, error: "Not a league member" };

  const { data: roster } = await admin
    .from("rosters")
    .select("player_id, players(division)")
    .eq("league_id", leagueId)
    .eq("team_id", member.id);
  const divByPlayer = new Map<number, string>(
    (roster ?? []).map((r: any) => [r.player_id as number, (r.players?.division as string) ?? "MPO"]),
  );

  // Sanitize: on-roster players only, division must match the slot, orders in
  // range, no duplicate players or slots.
  const seenPlayers = new Set<number>();
  const seenSlots = new Set<string>();
  const clean: PlannedStarter[] = [];
  for (const s of Array.isArray(starters) ? starters : []) {
    const playerId = Number(s?.player_id);
    const slot = s?.slot === "FPO" ? "FPO" : "MPO";
    const order = Number(s?.order);
    const cap = slot === "FPO" ? fpoSlots : mpoSlots;
    if (
      !Number.isInteger(playerId) ||
      divByPlayer.get(playerId) !== slot ||
      !Number.isInteger(order) || order < 1 || order > cap ||
      seenPlayers.has(playerId) || seenSlots.has(`${slot}${order}`)
    ) {
      continue;
    }
    seenPlayers.add(playerId);
    seenSlots.add(`${slot}${order}`);
    clean.push({ player_id: playerId, slot, order });
  }

  const { error } = await admin.from("lineup_plans").upsert(
    {
      league_id: leagueId,
      team_id: member.id,
      week,
      starters: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_id,team_id,week" },
  );
  if (error) return { ok: false, error: "Could not save — has the lineup_plans migration been run?" };

  revalidatePath(`/league/${leagueId}/lineups`);
  return { ok: true };
}
