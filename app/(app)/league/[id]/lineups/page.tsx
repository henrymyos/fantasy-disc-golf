import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toggleStarter, dropPlayer } from "@/actions/rosters";

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

  // Fetch division-specific starter counts (columns may not exist on older DBs)
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

  // Split starters by division, capped to slot count
  const mpoStarters = roster
    .filter((r) => r.is_starter && (r.players as any)?.division === "MPO")
    .slice(0, mpoSlots);
  const fpoStarters = roster
    .filter((r) => r.is_starter && (r.players as any)?.division === "FPO")
    .slice(0, fpoSlots);

  // Bench = everyone not in the above starter slots
  const starterIds = new Set([...mpoStarters, ...fpoStarters].map((r) => r.id));
  const bench = roster.filter((r) => !starterIds.has(r.id));

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
          {/* MPO slots */}
          {Array.from({ length: mpoSlots }, (_, i) => {
            const spot = mpoStarters[i];
            return (
              <SlotRow
                key={`mpo-${i}`}
                division="MPO"
                spot={spot ?? null}
                leagueId={Number(id)}
              />
            );
          })}
          {/* FPO slots */}
          {Array.from({ length: fpoSlots }, (_, i) => {
            const spot = fpoStarters[i];
            return (
              <SlotRow
                key={`fpo-${i}`}
                division="FPO"
                spot={spot ?? null}
                leagueId={Number(id)}
              />
            );
          })}
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

function SlotRow({
  division,
  spot,
  leagueId,
}: {
  division: "MPO" | "FPO";
  spot: any | null;
  leagueId: number;
}) {
  const isMpo = division === "MPO";
  const color = isMpo ? "#4B3DFF" : "#36D7B7";
  const bgColor = isMpo ? "rgba(75,61,255,0.12)" : "rgba(54,215,183,0.10)";
  const player = spot?.players;

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border"
      style={{
        background: spot ? bgColor : "rgba(255,255,255,0.02)",
        borderColor: spot ? `${color}30` : "rgba(255,255,255,0.06)",
      }}
    >
      {/* Division badge */}
      <div
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {division}
      </div>

      {/* Player or empty */}
      {player ? (
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{player.name}</p>
        </div>
      ) : (
        <p className="flex-1 text-gray-600 text-sm italic">Empty</p>
      )}

      {/* Actions */}
      {spot && (
        <div className="flex items-center gap-2 shrink-0">
          <form action={toggleStarter.bind(null, leagueId, spot.id, false)}>
            <button
              type="submit"
              className="text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1 rounded-full transition"
            >
              Bench
            </button>
          </form>
          <form action={dropPlayer.bind(null, leagueId, spot.player_id)}>
            <button
              type="submit"
              className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-3 py-1 rounded-full transition"
            >
              Drop
            </button>
          </form>
        </div>
      )}
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
        <form action={dropPlayer.bind(null, leagueId, spot.player_id)}>
          <button
            type="submit"
            className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-3 py-1 rounded-full transition"
          >
            Drop
          </button>
        </form>
      </div>
    </div>
  );
}
