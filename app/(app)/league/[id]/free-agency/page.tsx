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

  // Get all players not on any roster = free agents
  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division")
    .order("name");

  const freeAgents = (allPlayers ?? []).filter((p) => !rosteredIds.has(p.id));

  // My roster (for potential drops)
  const { data: myRoster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id);

  const rosterFull = (myRoster ?? []).length >= league.roster_size;

  return (
    <div className="max-w-2xl space-y-4">
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
        <div className="space-y-2">
          {freeAgents.map((player) => (
            <div
              key={player.id}
              className="bg-[#1a1d23] border border-white/5 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white text-sm font-bold">
                  {player.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{player.name}</p>
                  <p className="text-gray-500 text-xs">{player.division ?? "MPO"} · Free Agent</p>
                </div>
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
                    className="text-sm bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-4 py-1.5 rounded-full font-medium transition"
                  >
                    Add
                  </button>
                </form>
              )}
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
