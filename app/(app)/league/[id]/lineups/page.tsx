import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LineupSlot, BenchSlot } from "@/components/lineup-slot";
import { TeamActionsPanel } from "@/components/team-actions-panel";
import { getActiveTournament } from "@/lib/lineup-lock";

export default async function LineupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, starters_count, roster_size")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: divData } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters")
    .eq("id", id)
    .single();

  const mpoSlots: number = (divData as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (divData as any)?.fpo_starters ?? 2;

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard");

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, lineup_order, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const roster = (myRoster ?? []) as any[];

  const activeTournament = await getActiveTournament(supabase);
  const lineupLocked = activeTournament !== null;

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
              Lineup changes reopen after {new Date(activeTournament.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
            </p>
          </div>
        </div>
      )}

      <TeamActionsPanel
        leagueId={Number(id)}
        myTeamId={myMember.id}
        rosterTxs={rosterTxs}
        completedTrades={completedTrades}
      />

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">{myMember.team_name}</h2>
          <span className="text-gray-500 text-sm">{totalFilledStarters}/{totalSlots} starters</span>
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
            />
          ))}
        </div>

        {bench.length > 0 && (
          <>
            <h3 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Bench</h3>
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
                  />
                );
              })}
            </div>
          </>
        )}

        {roster.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-4">
            No players on your roster yet. Add players in Free Agency.
          </p>
        )}
      </div>
    </div>
  );
}
