import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toggleStarter } from "@/actions/rosters";
import { ConfirmDropButton } from "@/components/confirm-drop-button";
import { LineupSlot } from "@/components/lineup-slot";

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
          {Array.from({ length: mpoSlots }, (_, i) => (
            <LineupSlot
              key={`mpo-${i}`}
              leagueId={Number(id)}
              division="MPO"
              slotIndex={i + 1}
              occupant={(mpoStarters[i] ?? null) as any}
              benchPlayers={mpoBench as any}
            />
          ))}
          {Array.from({ length: fpoSlots }, (_, i) => (
            <LineupSlot
              key={`fpo-${i}`}
              leagueId={Number(id)}
              division="FPO"
              slotIndex={i + 1}
              occupant={(fpoStarters[i] ?? null) as any}
              benchPlayers={fpoBench as any}
            />
          ))}
        </div>

        {/* Bench */}
        {bench.length > 0 && (
          <>
            <h3 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Bench</h3>
            <div className="space-y-2">
              {bench.map((spot) => {
                const player = (spot as any).players;
                const div: "MPO" | "FPO" = player?.division ?? "MPO";
                const slotsFull = div === "MPO"
                  ? mpoStarters.length >= mpoSlots
                  : fpoStarters.length >= fpoSlots;
                return (
                  <BenchRow
                    key={spot.id}
                    spot={spot}
                    leagueId={Number(id)}
                    slotsFull={slotsFull}
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

function BenchRow({
  spot,
  leagueId,
  slotsFull,
}: {
  spot: any;
  leagueId: number;
  slotsFull: boolean;
}) {
  const player = spot.players;
  const div: "MPO" | "FPO" = player?.division ?? "MPO";
  const isMpo = div === "MPO";
  const color = isMpo ? "#4B3DFF" : "#36D7B7";

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[#0f1117] border border-white/5 group">
      <div
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {div}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{player?.name}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition">
        {!slotsFull && (
          <form action={toggleStarter.bind(null, leagueId, spot.id, true)}>
            <button
              type="submit"
              className="text-xs font-semibold px-3 py-1 rounded-full border transition"
              style={{ color, borderColor: `${color}50` }}
            >
              Start
            </button>
          </form>
        )}
        <ConfirmDropButton
          leagueId={leagueId}
          playerId={spot.player_id}
          playerName={player?.name ?? "Player"}
        />
      </div>
    </div>
  );
}
