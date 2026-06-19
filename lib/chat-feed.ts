import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Structured league activity (trades + roster moves) rendered as Sleeper-style
 * system messages inside the league chat. Built on the read side so it needs no
 * schema changes and automatically reflects history as well as new events.
 */

export type FeedAsset =
  | { type: "player"; name: string; division: string | null; avatarUrl: string | null }
  | { type: "pick"; label: string };

export type TradeEvent = {
  id: string;
  kind: "trade";
  ts: string;
  teams: { teamName: string; gains: FeedAsset[]; losses: FeedAsset[] }[];
};

export type MoveEvent = {
  id: string;
  kind: "move";
  ts: string;
  actor: string;
  gains: FeedAsset[];
  losses: FeedAsset[];
};

export type SystemEvent = TradeEvent | MoveEvent;

function roundOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function playerAsset(p: { name?: string | null; division?: string | null; avatar_url?: string | null } | null): FeedAsset {
  return {
    type: "player",
    name: p?.name ?? "A player",
    division: p?.division ?? null,
    avatarUrl: p?.avatar_url ?? null,
  };
}

/** Builds the trade + roster-move timeline for a league, newest last. */
export async function buildLeagueSystemFeed(
  supabase: SupabaseClient,
  leagueId: number,
  limit = 40,
): Promise<SystemEvent[]> {
  const { data: memberRows } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", leagueId);
  const teamName = new Map<number, string>(
    (memberRows ?? []).map((m: any) => [m.id as number, (m.team_name as string) ?? "A team"]),
  );

  const { data: txs } = await supabase
    .from("roster_transactions")
    .select(
      "id, action, created_at, team:league_members!roster_transactions_team_id_fkey(team_name), player:players!roster_transactions_player_id_fkey(name, division, avatar_url), dropped:players!roster_transactions_dropped_player_id_fkey(name, division, avatar_url)",
    )
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data: trades } = await supabase
    .from("trades")
    .select(
      "id, status, resolved_at, proposer_id, trade_players(from_team_id, to_team_id, players(name, division, avatar_url)), trade_picks(season_year, round, original_team_id, from_team_id, to_team_id)",
    )
    .eq("league_id", leagueId)
    .eq("status", "accepted")
    .order("resolved_at", { ascending: false })
    .limit(limit);

  const events: SystemEvent[] = [];

  for (const t of txs ?? []) {
    const actor = (t as any).team?.team_name ?? "A team";
    const player = playerAsset((t as any).player);
    const dropped = (t as any).dropped ? playerAsset((t as any).dropped) : null;
    if (t.action === "add") {
      events.push({
        id: `txn-${t.id}`,
        kind: "move",
        ts: t.created_at,
        actor,
        gains: [player],
        losses: dropped ? [dropped] : [],
      });
    } else if (t.action === "drop") {
      events.push({
        id: `txn-${t.id}`,
        kind: "move",
        ts: t.created_at,
        actor,
        gains: [],
        losses: [player],
      });
    }
  }

  for (const tr of trades ?? []) {
    const ts = (tr as any).resolved_at;
    if (!ts) continue;
    const tps: any[] = (tr as any).trade_players ?? [];
    const tpicks: any[] = (tr as any).trade_picks ?? [];

    // Gather every team involved, then bucket each asset as a gain/loss per team.
    const order: number[] = [];
    const buckets = new Map<number, { gains: FeedAsset[]; losses: FeedAsset[] }>();
    const ensure = (id: number) => {
      let b = buckets.get(id);
      if (!b) {
        b = { gains: [], losses: [] };
        buckets.set(id, b);
        order.push(id);
      }
      return b;
    };
    // Proposer's roster shows first, matching the trade proposal's perspective.
    if ((tr as any).proposer_id != null) ensure((tr as any).proposer_id);

    for (const tp of tps) {
      const asset = playerAsset(tp.players);
      if (tp.to_team_id != null) ensure(tp.to_team_id).gains.push(asset);
      if (tp.from_team_id != null) ensure(tp.from_team_id).losses.push(asset);
    }
    for (const pk of tpicks) {
      const orig = pk.original_team_id != null ? teamName.get(pk.original_team_id) : null;
      const label = `${pk.season_year} ${roundOrdinal(pk.round)} Rd${orig ? ` (${orig})` : ""}`;
      const asset: FeedAsset = { type: "pick", label };
      if (pk.to_team_id != null) ensure(pk.to_team_id).gains.push(asset);
      if (pk.from_team_id != null) ensure(pk.from_team_id).losses.push(asset);
    }

    events.push({
      id: `trade-${tr.id}`,
      kind: "trade",
      ts,
      teams: order.map((id) => ({
        teamName: teamName.get(id) ?? "A team",
        gains: buckets.get(id)!.gains,
        losses: buckets.get(id)!.losses,
      })),
    });
  }

  // Oldest first so they slot into the bottom-anchored chat timeline.
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return events.slice(-limit);
}
