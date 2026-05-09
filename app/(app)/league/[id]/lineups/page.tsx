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

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id);

  const roster = myRoster ?? [];

  const mpoStarters = roster
    .filter((r) => r.is_starter && (r.players as any)?.division === "MPO")
    .slice(0, mpoSlots);
  const fpoStarters = roster
    .filter((r) => r.is_starter && (r.players as any)?.division === "FPO")
    .slice(0, fpoSlots);

  const starterIds = new Set([...mpoStarters, ...fpoStarters].map((r) => r.id));
  const bench = roster.filter((r) => !starterIds.has(r.id));

  const mpoBench = bench.filter((r) => (r.players as any)?.division === "MPO");
  const fpoBench = bench.filter((r) => (r.players as any)?.division === "FPO");

  // Slot arrays used by BenchSlot picker: length = N slots, null = empty
  const mpoSlotArray = Array.from({ length: mpoSlots }, (_, i) => (mpoStarters[i] ?? null) as any);
  const fpoSlotArray = Array.from({ length: fpoSlots }, (_, i) => (fpoStarters[i] ?? null) as any);

  const totalFilledStarters = mpoStarters.length + fpoStarters.length;
  const totalSlots = mpoSlots + fpoSlots;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">{myMember.team_name}</h2>
          <span className="text-gray-500 text-sm">{totalFilledStarters}/{totalSlots} starters</span>
        </div>

        {/* Starter slots */}
        <div className="space-y-2 mb-6">
          {mpoSlotArray.map((occupant: any, i: number) => (
            <LineupSlot
              key={`mpo-${i}`}
              leagueId={Number(id)}
              division="MPO"
              slotIndex={i + 1}
              occupant={occupant}
              benchPlayers={mpoBench as any}
              otherStarters={mpoStarters.filter((_, j) => j !== i) as any}
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
              otherStarters={fpoStarters.filter((_, j) => j !== i) as any}
            />
          ))}
        </div>

        {/* Bench */}
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
