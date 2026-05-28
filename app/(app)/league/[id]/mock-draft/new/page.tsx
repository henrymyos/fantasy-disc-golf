import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MockDraft } from "@/components/mock-draft";

export default async function MockDraftPage({
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
    .select("id, name, max_teams, roster_size, mpo_starters, fpo_starters")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const { data: players } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false });

  // Total fantasy points this season, used as the primary sort to match the
  // draft board's available-players ordering.
  const { data: resultRows } = await supabase
    .from("tournament_results")
    .select("player_id, fantasy_points");
  const pointsByPlayer = new Map<number, number>();
  (resultRows ?? []).forEach((r: any) => {
    pointsByPlayer.set(
      r.player_id,
      (pointsByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0),
    );
  });

  return (
    <MockDraft
      leagueId={id}
      leagueName={league.name}
      numTeams={league.max_teams}
      rosterSize={league.roster_size}
      mpoStarters={(league as any).mpo_starters ?? 4}
      fpoStarters={(league as any).fpo_starters ?? 2}
      players={(players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        division: p.division as "MPO" | "FPO",
        worldRanking: p.world_ranking as number | null,
        overallRank: (p as any).overall_rank as number | null,
        totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
      }))}
    />
  );
}
