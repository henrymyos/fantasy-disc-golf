import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MockDraft } from "@/components/mock-draft";
import { MockAuction } from "@/components/mock-auction";

type SavedPick = { pickNumber: number; teamIndex: number; playerId: number | null; price?: number };

export default async function MockDraftViewerPage({
  params,
}: {
  params: Promise<{ id: string; mockDraftId: string }>;
}) {
  const { id, mockDraftId } = await params;
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

  const admin = createAdminClient();
  const { data: mock } = await admin
    .from("mock_drafts")
    .select("id, user_id, league_id, my_draft_position, num_teams, roster_size, picks, created_at, status, draft_type, auction_budget, third_round_reversal")
    .eq("id", Number(mockDraftId))
    .single();

  if (!mock || mock.user_id !== user.id || String(mock.league_id) !== id) notFound();

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

  const mappedPlayers = (players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    division: p.division as "MPO" | "FPO",
    worldRanking: p.world_ranking as number | null,
    overallRank: (p as any).overall_rank as number | null,
    totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
  }));

  if ((mock as any).draft_type === "auction") {
    return (
      <MockAuction
        leagueId={id}
        leagueName={league.name}
        numTeams={mock.num_teams}
        rosterSize={mock.roster_size}
        mpoStarters={(league as any).mpo_starters ?? 4}
        fpoStarters={(league as any).fpo_starters ?? 2}
        budget={(mock as any).auction_budget ?? 200}
        players={mappedPlayers}
        initialMockDraft={{
          id: mock.id,
          myDraftPosition: mock.my_draft_position,
          picks: ((mock.picks ?? []) as SavedPick[])
            .filter((p): p is SavedPick & { playerId: number } => p.playerId != null)
            .map((p) => ({
              pickNumber: p.pickNumber,
              teamIndex: p.teamIndex,
              playerId: p.playerId,
              price: p.price ?? 0,
            })),
          createdAt: mock.created_at,
          status: ((mock as any).status ?? "complete") as "in_progress" | "complete",
        }}
      />
    );
  }

  return (
    <MockDraft
      leagueId={id}
      leagueName={league.name}
      numTeams={mock.num_teams}
      rosterSize={mock.roster_size}
      mpoStarters={(league as any).mpo_starters ?? 4}
      fpoStarters={(league as any).fpo_starters ?? 2}
      thirdRoundReversal={!!(mock as any).third_round_reversal}
      players={mappedPlayers}
      initialMockDraft={{
        id: mock.id,
        myDraftPosition: mock.my_draft_position,
        picks: (mock.picks ?? []) as SavedPick[],
        createdAt: mock.created_at,
        status: ((mock as any).status ?? "complete") as "in_progress" | "complete",
      }}
    />
  );
}
