import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LineupSlot, BenchSlot } from "@/components/lineup-slot";
import { TeamActionsPanel } from "@/components/team-actions-panel";
import { getActiveTournament } from "@/lib/lineup-lock";
import { getLeagueNextTournamentId } from "@/lib/league-schedule";
import { applyProjectionVariance } from "@/lib/projections";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";

export default async function LineupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, starters_count, roster_size, current_week")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: divData } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters, scoring_mode")
    .eq("id", id)
    .single();

  const mpoSlots: number = (divData as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (divData as any)?.fpo_starters ?? 2;
  const scoringMode = (((divData as any)?.scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard?home=1");

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, lineup_order, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const roster = (myRoster ?? []) as any[];

  // Attach this team's player nicknames, shown under each name.
  const { data: nickRows } = await supabase
    .from("player_nicknames")
    .select("player_id, nickname")
    .eq("team_id", myMember.id);
  const nickByPlayer = new Map<number, string>(
    (nickRows ?? []).map((n: any) => [n.player_id as number, n.nickname as string]),
  );
  for (const r of roster) {
    r.nickname = nickByPlayer.get(r.player_id) ?? null;
  }

  const activeTournament = await getActiveTournament(supabase, Number(id));
  const lineupLocked = activeTournament !== null;

  // Per-player projected and actual points for the next calendar event on
  // the schedule (the in-progress event if one is happening, else the
  // earliest upcoming event by start_date).
  const playerIds = roster.map((r: any) => r.player_id);
  const nextTournamentId: number | null =
    activeTournament?.id ?? (await getLeagueNextTournamentId(supabase, Number(id)));

  const { data: allResults } = playerIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, fantasy_points")
        .in("player_id", playerIds)
    : { data: [] };
  const totalsByPlayer = new Map<number, number>();
  const eventsByPlayer = new Map<number, number>();
  const weekActualByPlayer = new Map<number, number>();
  (allResults ?? []).forEach((r: any) => {
    totalsByPlayer.set(r.player_id, (totalsByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
    eventsByPlayer.set(r.player_id, (eventsByPlayer.get(r.player_id) ?? 0) + 1);
    if (nextTournamentId != null && r.tournament_id === nextTournamentId) {
      weekActualByPlayer.set(r.player_id, (weekActualByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
    }
  });

  // Registered set for the target tournament — anyone not in it is OUT.
  let registeredSet: Set<number> | null = null;
  if (nextTournamentId != null) {
    const { data: regRow } = await supabase
      .from("tournaments")
      .select("registered_player_ids")
      .eq("id", nextTournamentId)
      .maybeSingle();
    const ids = (regRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) registeredSet = new Set(ids);
  }

  // playerId → { projected, actual, isOut }. Also build a serializable
  // object form for passing to client components.
  const pointsByPlayerId: Record<number, { projected: number | null; actual: number | null; isOut: boolean }> = {};
  const weekPointsByPlayer = new Map<number, { projected: number | null; actual: number | null; isOut: boolean }>();
  for (const pid of playerIds) {
    const total = totalsByPlayer.get(pid) ?? 0;
    const events = eventsByPlayer.get(pid) ?? 0;
    const seasonProj = events > 0
      ? applyProjectionVariance(total / events, pid, 3)
      : null;
    const actual = weekActualByPlayer.get(pid) ?? null;
    const isOut =
      registeredSet != null
      && !registeredSet.has(pid)
      && actual == null;
    const entry = {
      projected: isOut ? 0 : seasonProj,
      actual: actual != null ? Math.round(actual * 10) / 10 : null,
      isOut,
    };
    weekPointsByPlayer.set(pid, entry);
    pointsByPlayerId[pid] = entry;
  }

  function buildSlotArray(starters: any[], numSlots: number): (any | null)[] {
    const result: (any | null)[] = new Array(numSlots).fill(null);
    const unordered: any[] = [];
    for (const s of starters) {
      const o = (s as any).lineup_order;
      if (o != null && o >= 1 && o <= numSlots && result[o - 1] === null) {
        result[o - 1] = s;
      } else {
        unordered.push(s);
      }
    }
    let ui = 0;
    for (let i = 0; i < numSlots && ui < unordered.length; i++) {
      if (result[i] === null) result[i] = unordered[ui++];
    }
    return result;
  }

  const allMpoStarters = roster.filter((r) => r.is_starter && (r.players as any)?.division === "MPO");
  const allFpoStarters = roster.filter((r) => r.is_starter && (r.players as any)?.division === "FPO");

  const mpoSlotArray = buildSlotArray(allMpoStarters, mpoSlots);
  const fpoSlotArray = buildSlotArray(allFpoStarters, fpoSlots);

  const starterIds = new Set([...mpoSlotArray, ...fpoSlotArray].filter(Boolean).map((r: any) => r.id));
  const bench = roster.filter((r) => !starterIds.has(r.id));

  const mpoBench = bench.filter((r) => (r.players as any)?.division === "MPO");
  const fpoBench = bench.filter((r) => (r.players as any)?.division === "FPO");

  function otherSlotsFor(slotArray: any[], skipIdx: number) {
    return slotArray
      .map((spot: any, i: number) => ({ spot: spot as any | null, slotIndex: i + 1 }))
      .filter(({ slotIndex: si }) => si !== skipIdx + 1);
  }

  const totalFilledStarters = mpoSlotArray.filter(Boolean).length + fpoSlotArray.filter(Boolean).length;
  const totalSlots = mpoSlots + fpoSlots;
  const overRoster = roster.length > league.roster_size;
  const toDrop = roster.length - league.roster_size;
  const lineupsDisabled = overRoster || lineupLocked;

  // Compute the team's current W-L for the header.
  const { data: allMatchups } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score, is_final")
    .eq("league_id", id)
    .eq("is_final", true);
  let myWins = 0;
  let myLosses = 0;
  if (scoringMode === "head_to_head") {
    (allMatchups ?? []).forEach((m: any) => {
      if (m.team1_id === myMember.id) {
        if (m.team1_score > m.team2_score) myWins++;
        else if (m.team2_score > m.team1_score) myLosses++;
      } else if (m.team2_id === myMember.id) {
        if (m.team2_score > m.team1_score) myWins++;
        else if (m.team1_score > m.team2_score) myLosses++;
      }
    });
  } else {
    const weekly = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weekly, scoringMode);
    const rec = alt.get(myMember.id);
    if (rec) {
      myWins = rec.wins;
      myLosses = rec.losses;
    }
  }

  // Fetch transaction history
  const { data: txRows } = await supabase
    .from("roster_transactions")
    .select("id, action, created_at, players!roster_transactions_player_id_fkey(name, division), dropped:players!roster_transactions_dropped_player_id_fkey(name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const rosterTxs = (txRows ?? []).map((t: any) => ({
    id: t.id,
    action: t.action as "add" | "drop",
    createdAt: t.created_at,
    playerName: t.players?.name ?? "Unknown",
    playerDivision: t.players?.division ?? "MPO",
    droppedName: t.dropped?.name ?? null,
    droppedDivision: t.dropped?.division ?? null,
  }));

  // Fetch completed trades involving this team
  const { data: tradeRows } = await supabase
    .from("trades")
    .select(`
      id, status, resolved_at, message,
      proposer:league_members!trades_proposer_id_fkey(id, team_name),
      receiver:league_members!trades_receiver_id_fkey(id, team_name),
      trade_players(player_id, from_team_id, to_team_id, players(name))
    `)
    .eq("league_id", id)
    .in("status", ["accepted", "rejected"])
    .or(`proposer_id.eq.${myMember.id},receiver_id.eq.${myMember.id}`)
    .order("resolved_at", { ascending: false })
    .limit(20);

  const completedTrades = (tradeRows ?? []).map((t: any) => {
    const proposer = t.proposer;
    const receiver = t.receiver;
    const otherTeam = proposer?.id === myMember.id ? receiver?.team_name : proposer?.team_name;
    const received = (t.trade_players ?? [])
      .filter((tp: any) => tp.to_team_id === myMember.id)
      .map((tp: any) => tp.players?.name ?? "");
    const gave = (t.trade_players ?? [])
      .filter((tp: any) => tp.from_team_id === myMember.id)
      .map((tp: any) => tp.players?.name ?? "");
    return {
      id: t.id,
      status: t.status as "accepted" | "rejected",
      resolvedAt: t.resolved_at ?? "",
      otherTeam: otherTeam ?? "Unknown",
      received,
      gave,
    };
  });

  // This team's pending waiver claims (shown + reorderable in the panel).
  const { data: claimRows } = await supabase
    .from("waiver_claims")
    .select("id, player_id, drop_player_id, claim_order, submitted_at")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .eq("status", "pending")
    .order("claim_order", { ascending: true, nullsFirst: false })
    .order("submitted_at", { ascending: true });
  const claimPlayerIds = [
    ...new Set((claimRows ?? []).flatMap((c: any) => [c.player_id, c.drop_player_id]).filter(Boolean)),
  ] as number[];
  const { data: claimPlayers } = claimPlayerIds.length > 0
    ? await supabase.from("players").select("id, name, division").in("id", claimPlayerIds)
    : { data: [] };
  const claimPmap = new Map<number, any>((claimPlayers ?? []).map((p: any) => [p.id, p]));
  const pendingWaiverClaims = (claimRows ?? []).map((c: any) => ({
    id: c.id as number,
    addName: claimPmap.get(c.player_id)?.name ?? "Unknown",
    addDivision: claimPmap.get(c.player_id)?.division ?? "MPO",
    dropName: c.drop_player_id ? (claimPmap.get(c.drop_player_id)?.name ?? null) : null,
    dropDivision: c.drop_player_id ? (claimPmap.get(c.drop_player_id)?.division ?? null) : null,
  }));

  return (
    <div className="max-w-2xl space-y-4">
      {overRoster && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-red-400 font-semibold text-sm">Roster over limit</p>
            <p className="text-red-300/80 text-xs mt-0.5">
              You have {roster.length} players but the max is {league.roster_size}.
              Drop {toDrop} player{toDrop !== 1 ? "s" : ""} to unlock lineup changes.
            </p>
          </div>
        </div>
      )}

      {lineupLocked && activeTournament && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-yellow-400 text-lg leading-none mt-0.5">🔒</span>
          <div>
            <p className="text-yellow-300 font-semibold text-sm">Lineup locked — {activeTournament.name} is in progress</p>
            <p className="text-yellow-300/70 text-xs mt-0.5">
              {/* end_date is a bare "YYYY-MM-DD"; append a time so it renders as
                  the same calendar date regardless of server timezone (a plain
                  `new Date("YYYY-MM-DD")` would parse as UTC midnight). */}
              Lineup changes reopen after {new Date(activeTournament.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
            </p>
          </div>
        </div>
      )}

      <TeamActionsPanel
        leagueId={Number(id)}
        myTeamId={myMember.id}
        rosterTxs={rosterTxs}
        completedTrades={completedTrades}
        pendingClaims={pendingWaiverClaims}
      />

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">{myMember.team_name}</h2>
          {(() => {
            const starterSpots = [...mpoSlotArray, ...fpoSlotArray].filter(Boolean) as any[];
            let projTotal = 0;
            let actualTotal = 0;
            let anyActual = false;
            for (const s of starterSpots) {
              const wp = weekPointsByPlayer.get(s.player_id);
              if (!wp) continue;
              if (wp.actual != null) { actualTotal += wp.actual; anyActual = true; }
              if (wp.projected != null) projTotal += wp.projected;
            }
            const displayTotal = anyActual ? actualTotal : projTotal;
            return (
              <div className="text-right">
                <p className="text-white font-semibold text-sm tabular-nums">{myWins}-{myLosses}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {anyActual ? "" : "~"}{displayTotal.toFixed(1)} pts {anyActual ? "this event" : "projected"}
                </p>
              </div>
            );
          })()}
        </div>

        <div className="space-y-2 mb-6">
          {mpoSlotArray.map((occupant: any, i: number) => (
            <LineupSlot
              key={`mpo-${i}`}
              leagueId={Number(id)}
              division="MPO"
              slotIndex={i + 1}
              occupant={occupant}
              benchPlayers={mpoBench as any}
              otherStarters={otherSlotsFor(mpoSlotArray, i)}
              locked={lineupsDisabled}
              weekPoints={occupant ? weekPointsByPlayer.get(occupant.player_id) ?? null : null}
              pointsByPlayerId={pointsByPlayerId}
            />
          ))}
          {fpoSlotArray.map((occupant: any, i: number) => (
            <LineupSlot
              key={`fpo-${i}`}
              leagueId={Number(id)}
              division="FPO"
              slotIndex={i + 1}
              occupant={occupant}
              benchPlayers={fpoBench as any}
              otherStarters={otherSlotsFor(fpoSlotArray, i)}
              locked={lineupsDisabled}
              weekPoints={occupant ? weekPointsByPlayer.get(occupant.player_id) ?? null : null}
              pointsByPlayerId={pointsByPlayerId}
            />
          ))}
        </div>

        {bench.length > 0 && (
          <>
            <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Bench</h3>
            <div className="space-y-2">
              {bench.map((spot) => {
                const div = (spot.players as any)?.division ?? "MPO";
                return (
                  <BenchSlot
                    key={spot.id}
                    leagueId={Number(id)}
                    benchSpot={spot as any}
                    starterSlots={div === "MPO" ? mpoSlotArray : fpoSlotArray}
                    locked={lineupsDisabled}
                    weekPoints={weekPointsByPlayer.get(spot.player_id) ?? null}
                    pointsByPlayerId={pointsByPlayerId}
                  />
                );
              })}
            </div>
          </>
        )}

        {roster.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-4">
            No players on your roster yet. Add players in Free Agency.
          </p>
        )}
      </div>
    </div>
  );
}
