import type { SupabaseClient } from "@supabase/supabase-js";

export type FeedItem = {
  id: string;
  ts: string;
  kind: "add" | "drop" | "trade" | "waiver_failed";
  description: string;
};

/** Aggregates recent league moves into a single timeline. */
export async function getActivityFeed(
  supabase: SupabaseClient,
  leagueId: number,
  limit = 25,
): Promise<FeedItem[]> {
  // Roster transactions (adds/drops).
  const { data: txs } = await supabase
    .from("roster_transactions")
    .select(
      "id, action, created_at, team:league_members!roster_transactions_team_id_fkey(team_name), player:players!roster_transactions_player_id_fkey(name), dropped:players!roster_transactions_dropped_player_id_fkey(name)",
    )
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Trades (accepted/rejected/cancelled).
  const { data: trades } = await supabase
    .from("trades")
    .select(
      "id, status, resolved_at, proposer:league_members!trades_proposer_id_fkey(team_name), trade_players(player_id, from_team_id, to_team_id, players(name)), trade_picks(season_year, round, from_team_id, to_team_id)",
    )
    .eq("league_id", leagueId)
    .in("status", ["accepted", "rejected", "cancelled"])
    .order("resolved_at", { ascending: false })
    .limit(limit);

  // Failed waiver claims (the successful ones already appear as roster_transactions adds).
  const { data: waiverFails } = await supabase
    .from("waiver_claims")
    .select(
      "id, status, processed_at, team:league_members!waiver_claims_team_id_fkey(team_name), player:players!waiver_claims_player_id_fkey(name)",
    )
    .eq("league_id", leagueId)
    .eq("status", "failed")
    .order("processed_at", { ascending: false })
    .limit(limit);

  const items: FeedItem[] = [];

  for (const t of txs ?? []) {
    const team = (t as any).team?.team_name ?? "A team";
    const player = (t as any).player?.name ?? "a player";
    const dropped = (t as any).dropped?.name;
    if (t.action === "add") {
      items.push({
        id: `tx-${t.id}`,
        ts: t.created_at,
        kind: "add",
        description: dropped
          ? `${team} added ${player}, dropped ${dropped}`
          : `${team} added ${player}`,
      });
    } else if (t.action === "drop") {
      items.push({
        id: `tx-${t.id}`,
        ts: t.created_at,
        kind: "drop",
        description: `${team} dropped ${player}`,
      });
    }
  }

  for (const tr of trades ?? []) {
    if (!(tr as any).resolved_at) continue;
    const proposer = (tr as any).proposer?.team_name ?? "A team";
    if ((tr as any).status === "accepted") {
      const tps: any[] = (tr as any).trade_players ?? [];
      const tpicks: any[] = (tr as any).trade_picks ?? [];
      const playerCount = tps.length;
      const pickCount = tpicks.length;
      const teamsInvolved = new Set<number>();
      for (const tp of tps) {
        teamsInvolved.add(tp.from_team_id);
        teamsInvolved.add(tp.to_team_id);
      }
      for (const tp of tpicks) {
        teamsInvolved.add(tp.from_team_id);
        teamsInvolved.add(tp.to_team_id);
      }
      const parts: string[] = [];
      if (playerCount > 0) parts.push(`${playerCount} player${playerCount !== 1 ? "s" : ""}`);
      if (pickCount > 0) parts.push(`${pickCount} pick${pickCount !== 1 ? "s" : ""}`);
      items.push({
        id: `trade-${tr.id}`,
        ts: (tr as any).resolved_at,
        kind: "trade",
        description: `Trade accepted between ${teamsInvolved.size} teams · ${parts.join(" + ")}`,
      });
    } else if ((tr as any).status === "rejected") {
      items.push({
        id: `trade-${tr.id}`,
        ts: (tr as any).resolved_at,
        kind: "trade",
        description: `${proposer}'s trade was rejected`,
      });
    } else if ((tr as any).status === "cancelled") {
      items.push({
        id: `trade-${tr.id}`,
        ts: (tr as any).resolved_at,
        kind: "trade",
        description: `${proposer} cancelled a trade`,
      });
    }
  }

  for (const w of waiverFails ?? []) {
    if (!(w as any).processed_at) continue;
    const team = (w as any).team?.team_name ?? "A team";
    const player = (w as any).player?.name ?? "a player";
    items.push({
      id: `waiver-${w.id}`,
      ts: (w as any).processed_at,
      kind: "waiver_failed",
      description: `${team}'s waiver claim for ${player} failed`,
    });
  }

  items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return items.slice(0, limit);
}
