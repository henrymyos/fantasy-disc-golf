import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FreeAgencyList } from "@/components/free-agency-list";

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

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const rosteredIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank");

  const freeAgents = (allPlayers ?? [])
    .filter((p) => !rosteredIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      division: p.division,
      worldRanking: p.world_ranking as number | null,
      overallRank: (p as any).overall_rank as number | null,
    }));

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("player_id");

  const rosterCount = (myRoster ?? []).length;
  const overLimit = rosterCount > league.roster_size;
  const openSpots = Math.max(0, league.roster_size - rosterCount);

  return (
    <div className="max-w-xl space-y-4">
      {overLimit && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-red-400 font-semibold text-sm">Roster over limit</p>
            <p className="text-red-300/80 text-xs mt-0.5">
              You have {rosterCount} players but the max is {league.roster_size}.
              Drop {rosterCount - league.roster_size} player{rosterCount - league.roster_size !== 1 ? "s" : ""} before adding anyone new.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold">Free Agents ({freeAgents.length})</h2>
        {!overLimit && openSpots === 0 && (
          <span className="text-yellow-400 text-xs bg-yellow-400/10 px-3 py-1 rounded-full">
            Roster full — pick a player to drop when adding
          </span>
        )}
        {!overLimit && openSpots > 0 && (
          <span className="text-gray-400 text-xs bg-white/5 px-3 py-1 rounded-full">
            {openSpots} open spot{openSpots !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {freeAgents.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">All players have been drafted. Check back after trades.</p>
        </div>
      ) : (
        <FreeAgencyList
          leagueId={Number(id)}
          freeAgents={freeAgents}
          myRoster={(myRoster ?? []) as any}
          openSpots={openSpots}
          overLimit={overLimit}
        />
      )}
    </div>
  );
}
