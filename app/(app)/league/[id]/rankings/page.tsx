import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RankingsEditor } from "@/components/rankings-editor";

export default async function RankingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
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
    .select("id, name, division, world_ranking, overall_rank");

  const { data: rankings } = await supabase
    .from("user_player_rankings")
    .select("player_id, rank")
    .eq("user_id", user.id)
    .eq("league_id", id)
    .order("rank", { ascending: true });

  // Total fantasy points this season — used as the primary sort for
  // unranked players so the starting order matches the draft board's
  // available-players list.
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

  const playerById = new Map<number, { id: number; name: string; division: string; overallRank: number | null; worldRanking: number | null }>();
  (players ?? []).forEach((p: any) => {
    playerById.set(p.id, {
      id: p.id,
      name: p.name,
      division: p.division,
      overallRank: p.overall_rank,
      worldRanking: p.world_ranking,
    });
  });

  const ranked = (rankings ?? [])
    .map((r: any) => playerById.get(r.player_id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const rankedIds = new Set(ranked.map((p) => p.id));
  const unranked = [...playerById.values()]
    .filter((p) => !rankedIds.has(p.id))
    .sort((a, b) => {
      const pa = pointsByPlayer.get(a.id) ?? 0;
      const pb = pointsByPlayer.get(b.id) ?? 0;
      if (pa !== pb) return pb - pa;
      return (a.overallRank ?? 9999) - (b.overallRank ?? 9999);
    });

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/draft`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Draft
        </Link>
        <h2 className="text-white font-bold text-xl">Your Draft Rankings</h2>
        <p className="text-gray-400 text-sm mt-1">
          Order the players you'd take. The Auto-pick button on the draft board pulls
          the highest-ranked available player from this list. If you don't rank a
          player, the bot falls back to overall ranking.
        </p>
      </div>

      <RankingsEditor leagueId={Number(id)} initialRanked={ranked} initialUnranked={unranked} />
    </div>
  );
}
