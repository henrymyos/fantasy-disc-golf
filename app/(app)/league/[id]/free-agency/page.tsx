import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addFreeAgent } from "@/actions/rosters";

export default async function FreeAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard");

  // Get all rostered player IDs in this league
  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const rosteredIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  // Get all players not on any roster = free agents, sorted by division then ranking
  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking");

  const freeAgents = (allPlayers ?? [])
    .filter((p) => !rosteredIds.has(p.id))
    .sort((a, b) => {
      // MPO before FPO
      if (a.division !== b.division) return a.division === "MPO" ? -1 : 1;
      // Within division: ranked players first, then unranked alphabetically
      if (a.world_ranking !== b.world_ranking) {
        if (a.world_ranking == null) return 1;
        if (b.world_ranking == null) return -1;
        return a.world_ranking - b.world_ranking;
      }
      return a.name.localeCompare(b.name);
    });

  // My roster (for potential drops)
  const { data: myRoster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id);

  const rosterFull = (myRoster ?? []).length >= league.roster_size;

  const mpo = freeAgents.filter((p) => p.division === "MPO");
  const fpo = freeAgents.filter((p) => p.division !== "MPO");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold">Free Agents ({freeAgents.length})</h2>
        {rosterFull && (
          <span className="text-yellow-400 text-xs bg-yellow-400/10 px-3 py-1 rounded-full">
            Roster full — pick a player to drop when adding
          </span>
        )}
      </div>

      {freeAgents.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">All players have been drafted. Check back after trades.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {[{ label: "MPO", players: mpo }, { label: "FPO", players: fpo }].map(({ label, players }) => (
            <div key={label}>
              <p className={`text-xs font-semibold uppercase tracking-wider px-1 mb-2 ${label === "MPO" ? "text-[#4B3DFF]" : "text-[#36D7B7]"}`}>{label}</p>
              <div className="space-y-1">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className="bg-[#1a1d23] border border-white/5 rounded-xl px-3 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-gray-600 text-xs font-mono w-6 text-right shrink-0">
                        {player.world_ranking != null ? `#${player.world_ranking}` : ""}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {player.name[0]?.toUpperCase()}
                      </div>
                      <p className="text-white font-medium text-sm truncate">{player.name}</p>
                    </div>

                    {rosterFull ? (
                      <AddWithDropForm
                        leagueId={Number(id)}
                        playerId={player.id}
                        myRoster={(myRoster ?? []) as any}
                      />
                    ) : (
                      <form action={addFreeAgent.bind(null, Number(id), player.id, undefined)}>
                        <button
                          type="submit"
                          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full font-medium transition shrink-0 ml-2"
                        >
                          Add
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddWithDropForm({
  leagueId,
  playerId,
  myRoster,
}: {
  leagueId: number;
  playerId: number;
  myRoster: { player_id: number; players: { id: number; name: string } | null }[];
}) {
  return (
    <form
      action={async (formData: FormData): Promise<void> => {
        "use server";
        const dropId = Number(formData.get("dropPlayerId"));
        await addFreeAgent(leagueId, playerId, dropId || undefined);
      }}
      className="flex items-center gap-2"
    >
      <select
        name="dropPlayerId"
        required
        className="bg-[#0f1117] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-[#4B3DFF]"
      >
        <option value="">Drop player...</option>
        {myRoster.map((spot) => (
          <option key={spot.player_id} value={spot.player_id}>
            {spot.players?.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full font-medium transition"
      >
        Add / Drop
      </button>
    </form>
  );
}
