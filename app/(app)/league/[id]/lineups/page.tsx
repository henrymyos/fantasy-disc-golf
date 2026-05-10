import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LineupSlot, BenchSlot } from "@/components/lineup-slot";

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

  // Sort by lineup_order (starters keep their assigned slot), then by id as stable fallback
  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, lineup_order, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const roster = myRoster ?? [];

  // Build a slot array that respects lineup_order:
  // starters with a valid lineup_order go to that exact slot; the rest fill remaining slots in id order.
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

  // All other slots for a given index: includes filled starters AND empty slots (null)
  function otherSlotsFor(slotArray: any[], skipIdx: number) {
    return slotArray
      .map((spot: any, i: number) => ({ spot: spot as any | null, slotIndex: i + 1 }))
      .filter(({ slotIndex: si }) => si !== skipIdx + 1);
  }

  const totalFilledStarters = mpoSlotArray.filter(Boolean).length + fpoSlotArray.filter(Boolean).length;
  const totalSlots = mpoSlots + fpoSlots;
  const overRoster = roster.length > league.roster_size;
  const toDrop = roster.length - league.roster_size;

  return (
    <div className="max-w-2xl space-y-6">
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
              locked={overRoster}
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
              locked={overRoster}
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
                    locked={overRoster}
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
