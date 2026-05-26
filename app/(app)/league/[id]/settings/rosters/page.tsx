import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CommissionerRostersEditor } from "@/components/commissioner-rosters-editor";

export default async function CommissionerRostersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if ((league as any).commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, joined_at")
    .eq("league_id", id)
    .order("joined_at");
  const teams = (members ?? []).map((m: any) => ({ id: m.id, teamName: m.team_name }));

  const { data: rostersRaw } = await supabase
    .from("rosters")
    .select("player_id, team_id, is_starter, players(name, division)")
    .eq("league_id", id);
  const rostered = (rostersRaw ?? []).map((r: any) => ({
    playerId: r.player_id,
    playerName: r.players?.name ?? "Unknown",
    division: (r.players?.division ?? "MPO") as "MPO" | "FPO",
    teamId: r.team_id,
    isStarter: !!r.is_starter,
  }));

  // Free agents = players not rostered in this league.
  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division")
    .order("name");
  const rosteredIds = new Set(rostered.map((r) => r.playerId));
  const freeAgents = (allPlayers ?? [])
    .filter((p: any) => !rosteredIds.has(p.id))
    .map((p: any) => ({
      playerId: p.id,
      playerName: p.name,
      division: (p.division ?? "MPO") as "MPO" | "FPO",
    }));

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Rosters</h2>
        <p className="text-gray-400 text-sm mt-1">
          Move players between teams or drop them to free agency. Every move is
          logged in the activity feed.
        </p>
      </div>

      <CommissionerRostersEditor
        leagueId={Number(id)}
        teams={teams}
        rostered={rostered}
        freeAgents={freeAgents}
      />
    </div>
  );
}
