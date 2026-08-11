import type { SupabaseClient } from "@supabase/supabase-js";

/** One staged starter in a future-week lineup plan. */
export type PlannedStarter = {
  player_id: number;
  slot: "MPO" | "FPO";
  /** 1-based slot index within the division. */
  order: number;
};

export type LineupSnapshot = {
  starters: PlannedStarter[];
  bench: number[];
};

/**
 * A team's staged lineup for a future week, or null when none is saved (or the
 * lineup_plans table hasn't been migrated yet — callers treat both the same:
 * fall back to the live roster's lineup).
 */
export async function getLineupPlan(
  supabase: SupabaseClient,
  leagueId: number,
  teamId: number,
  week: number,
): Promise<PlannedStarter[] | null> {
  try {
    const { data, error } = await supabase
      .from("lineup_plans")
      .select("starters")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("week", week)
      .maybeSingle();
    if (error) return null;
    const starters = (data as any)?.starters;
    return Array.isArray(starters) ? (starters as PlannedStarter[]) : null;
  } catch {
    return null;
  }
}

/** True when the lineup_plans table exists (the 2026-08 migration has run). */
export async function lineupPlansAvailable(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await supabase.from("lineup_plans").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** The finalized-week lineup snapshot for a team, or null if none recorded. */
export async function getLineupSnapshot(
  supabase: SupabaseClient,
  leagueId: number,
  teamId: number,
  week: number,
): Promise<LineupSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from("lineup_snapshots")
      .select("lineup")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("week", week)
      .maybeSingle();
    if (error) return null;
    const lineup = (data as any)?.lineup;
    if (!lineup || !Array.isArray(lineup.starters)) return null;
    return {
      starters: lineup.starters as PlannedStarter[],
      bench: Array.isArray(lineup.bench) ? (lineup.bench as number[]) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Applies every team's staged plan for `week` to the live rosters, then clears
 * plans up through that week. Called by advanceWeekCore right when `week`
 * becomes the league's current week — this is the moment a "future" lineup
 * turns into the real one. Planned players who have since been dropped/traded
 * are skipped (their slot is left empty for the owner to fill).
 *
 * Uses the service-role client; swallows errors (including a missing
 * lineup_plans table) so week advancement never breaks on this.
 */
export async function applyLineupPlansForWeek(
  admin: SupabaseClient,
  leagueId: number,
  week: number,
  mpoSlots: number,
  fpoSlots: number,
): Promise<void> {
  try {
    const { data: plans, error } = await admin
      .from("lineup_plans")
      .select("team_id, starters")
      .eq("league_id", leagueId)
      .eq("week", week);
    if (error) return;

    for (const plan of plans ?? []) {
      const teamId = (plan as any).team_id as number;
      const planned = ((plan as any).starters ?? []) as PlannedStarter[];
      if (!Array.isArray(planned) || planned.length === 0) continue;

      const { data: roster } = await admin
        .from("rosters")
        .select("id, player_id, players(division)")
        .eq("league_id", leagueId)
        .eq("team_id", teamId);
      const rowByPlayer = new Map<number, { id: number; division: string }>(
        (roster ?? []).map((r: any) => [
          r.player_id as number,
          { id: r.id as number, division: (r.players?.division as string) ?? "MPO" },
        ]),
      );

      // Keep only planned starters still on the roster whose division matches
      // their slot, capped to the league's slot counts, one player per slot.
      const seenPlayers = new Set<number>();
      const takenSlots = new Set<string>();
      const applied: Array<{ rosterId: number; order: number }> = [];
      for (const p of planned) {
        const row = rowByPlayer.get(p.player_id);
        const slotCap = p.slot === "FPO" ? fpoSlots : mpoSlots;
        if (
          !row ||
          row.division !== p.slot ||
          seenPlayers.has(p.player_id) ||
          !(p.order >= 1 && p.order <= slotCap) ||
          takenSlots.has(`${p.slot}${p.order}`)
        ) {
          continue;
        }
        seenPlayers.add(p.player_id);
        takenSlots.add(`${p.slot}${p.order}`);
        applied.push({ rosterId: row.id, order: p.order });
      }
      if (applied.length === 0) continue;

      await admin
        .from("rosters")
        .update({ is_starter: false, lineup_order: null })
        .eq("league_id", leagueId)
        .eq("team_id", teamId);
      for (const a of applied) {
        await admin
          .from("rosters")
          .update({ is_starter: true, lineup_order: a.order })
          .eq("id", a.rosterId);
      }
    }

    // Plans at or before the now-current week are spent (or stale) — clear them.
    await admin
      .from("lineup_plans")
      .delete()
      .eq("league_id", leagueId)
      .lte("week", week);
  } catch {
    // Table missing (migration not run) or transient failure — never block the
    // week advance on plans.
  }
}
