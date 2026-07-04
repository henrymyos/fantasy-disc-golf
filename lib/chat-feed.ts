import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Structured league activity (trades + roster moves) rendered as Sleeper-style
 * system messages inside the league chat. Built on the read side so it needs no
 * schema changes and automatically reflects history as well as new events.
 */

export type FeedAsset =
  | { type: "player"; name: string; nickname: string | null; division: string | null; avatarUrl: string | null }
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
  // "waiver" when this add came from a won waiver claim (vs. a free-agent add).
  via?: "waiver";
};

// A plain text notice: member joins, weekly results, draft scheduled.
export type NoticeEvent = {
  id: string;
  kind: "notice";
  ts: string;
  variant: "join" | "result" | "draft";
  title: string;
  lines?: string[];
  // Draft notices carry the raw scheduled time so the client can format it in
  // the viewer's own timezone.
  scheduledAt?: string | null;
};

export type SystemEvent = TradeEvent | MoveEvent | NoticeEvent;

function roundOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function playerAsset(
  p: { name?: string | null; division?: string | null; avatar_url?: string | null } | null,
  nickname: string | null = null,
): FeedAsset {
  return {
    type: "player",
    name: p?.name ?? "A player",
    nickname,
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
    .select("id, team_name, joined_at")
    .eq("league_id", leagueId);
  const teamName = new Map<number, string>(
    (memberRows ?? []).map((m: any) => [m.id as number, (m.team_name as string) ?? "A team"]),
  );

  // Keys of players won on waivers, so a waiver pickup reads differently from a
  // plain free-agent add.
  const { data: wonClaims } = await supabase
    .from("waiver_claims")
    .select("team_id, player_id")
    .eq("league_id", leagueId)
    .eq("status", "processed");
  const waiverKeys = new Set<string>(
    (wonClaims ?? []).map((c: any) => `${c.team_id}:${c.player_id}`),
  );

  // Per-team player nicknames, shown under each player's name in the feed.
  const { data: nickRows } = await supabase
    .from("player_nicknames")
    .select("team_id, player_id, nickname")
    .eq("league_id", leagueId);
  const nickMap = new Map<string, string>(
    (nickRows ?? []).map((n: any) => [`${n.team_id}:${n.player_id}`, n.nickname as string]),
  );
  const nickOf = (teamId: number | null | undefined, playerId: number | null | undefined): string | null =>
    teamId != null && playerId != null ? nickMap.get(`${teamId}:${playerId}`) ?? null : null;

  const { data: txs } = await supabase
    .from("roster_transactions")
    .select(
      "id, action, created_at, team_id, player_id, dropped_player_id, team:league_members!roster_transactions_team_id_fkey(team_name), player:players!roster_transactions_player_id_fkey(name, division, avatar_url), dropped:players!roster_transactions_dropped_player_id_fkey(name, division, avatar_url)",
    )
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data: trades } = await supabase
    .from("trades")
    .select(
      "id, status, resolved_at, proposer_id, trade_players(player_id, from_team_id, to_team_id, players(name, division, avatar_url)), trade_picks(season_year, round, original_team_id, from_team_id, to_team_id)",
    )
    .eq("league_id", leagueId)
    .eq("status", "accepted")
    .order("resolved_at", { ascending: false })
    .limit(limit);

  const events: SystemEvent[] = [];

  for (const t of txs ?? []) {
    const teamId = (t as any).team_id;
    const actor = (t as any).team?.team_name ?? "A team";
    const player = playerAsset((t as any).player, nickOf(teamId, (t as any).player_id));
    const dropped = (t as any).dropped
      ? playerAsset((t as any).dropped, nickOf(teamId, (t as any).dropped_player_id))
      : null;
    if (t.action === "add") {
      events.push({
        id: `txn-${t.id}`,
        kind: "move",
        ts: t.created_at,
        actor,
        gains: [player],
        losses: dropped ? [dropped] : [],
        via: waiverKeys.has(`${teamId}:${(t as any).player_id}`) ? "waiver" : undefined,
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
      if (tp.to_team_id != null)
        ensure(tp.to_team_id).gains.push(playerAsset(tp.players, nickOf(tp.to_team_id, tp.player_id)));
      if (tp.from_team_id != null)
        ensure(tp.from_team_id).losses.push(playerAsset(tp.players, nickOf(tp.from_team_id, tp.player_id)));
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

  // New members joining the league.
  for (const m of memberRows ?? []) {
    if (!(m as any).joined_at) continue;
    events.push({
      id: `join-${(m as any).id}`,
      kind: "notice",
      ts: (m as any).joined_at,
      variant: "join",
      title: `${(m as any).team_name ?? "A team"} joined the league`,
    });
  }

  // Finalized weekly results, one notice per week listing every matchup.
  const { data: finals } = await supabase
    .from("matchups")
    .select("week, team1_id, team2_id, team1_score, team2_score, finalized_at")
    .eq("league_id", leagueId)
    .eq("is_final", true)
    .not("finalized_at", "is", null);
  const weekBuckets = new Map<number, { ts: string; lines: string[] }>();
  for (const m of finals ?? []) {
    const wk = (m as any).week as number;
    const ts = (m as any).finalized_at as string;
    const t1 = teamName.get((m as any).team1_id) ?? "Team 1";
    const s1 = Number((m as any).team1_score ?? 0);
    const t2Id = (m as any).team2_id;
    const s2 = Number((m as any).team2_score ?? 0);
    let line: string;
    if (t2Id == null) {
      line = `${t1} had a bye (${s1.toFixed(1)})`;
    } else {
      const t2 = teamName.get(t2Id) ?? "Team 2";
      if (s1 === s2) line = `${t1} tied ${t2}, ${s1.toFixed(1)}–${s2.toFixed(1)}`;
      else if (s1 > s2) line = `${t1} def. ${t2}, ${s1.toFixed(1)}–${s2.toFixed(1)}`;
      else line = `${t2} def. ${t1}, ${s2.toFixed(1)}–${s1.toFixed(1)}`;
    }
    const cur = weekBuckets.get(wk) ?? { ts, lines: [] };
    if (ts > cur.ts) cur.ts = ts; // latest matchup finalized in the week anchors it
    cur.lines.push(line);
    weekBuckets.set(wk, cur);
  }
  for (const [wk, v] of weekBuckets) {
    events.push({
      id: `week-${wk}`,
      kind: "notice",
      ts: v.ts,
      variant: "result",
      title: `Week ${wk} results`,
      lines: v.lines,
    });
  }

  // Draft scheduled (only the current time; rescheduling moves the notice).
  const { data: draftRow } = await supabase
    .from("drafts")
    .select("id, scheduled_at, scheduled_set_at")
    .eq("league_id", leagueId)
    .maybeSingle();
  if ((draftRow as any)?.scheduled_set_at && (draftRow as any)?.scheduled_at) {
    events.push({
      id: `draft-sched-${(draftRow as any).id}`,
      kind: "notice",
      ts: (draftRow as any).scheduled_set_at,
      variant: "draft",
      title: "Draft scheduled",
      scheduledAt: (draftRow as any).scheduled_at,
    });
  }

  // Oldest first so they slot into the bottom-anchored chat timeline.
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return events.slice(-limit);
}
