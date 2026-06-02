import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MockDraft } from "@/components/mock-draft";
import type { MockSeats } from "@/lib/mock-draft-types";

type SavedPick = { pickNumber: number; teamIndex: number; playerId: number | null; price?: number };

// Live shared mock draft. Unlike the owner-only history view, any signed-in
// user can open this via the invite link — league membership is not required.
export default async function LiveMockDraftPage({
  params,
}: {
  params: Promise<{ id: string; mockDraftId: string }>;
}) {
  const { id, mockDraftId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: mock } = await admin
    .from("mock_drafts")
    .select(
      "id, user_id, league_id, my_draft_position, num_teams, roster_size, picks, created_at, status, is_shared, seats, third_round_reversal",
    )
    .eq("id", Number(mockDraftId))
    .single();

  // Only shared drafts are joinable here, and the URL's league must match.
  if (!mock || !(mock as any).is_shared || String(mock.league_id) !== id) notFound();

  const { data: league } = await admin
    .from("leagues")
    .select("id, name, mpo_starters, fpo_starters")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const { data: players } = await admin
    .from("players")
    .select("id, name, division, world_ranking, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false });

  // Total fantasy points this season → primary sort, matching the board's
  // available-players ordering.
  const { data: resultRows } = await admin
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

  return (
    <MockDraft
      leagueId={id}
      leagueName={league.name}
      numTeams={mock.num_teams}
      rosterSize={mock.roster_size}
      mpoStarters={(league as any).mpo_starters ?? 4}
      fpoStarters={(league as any).fpo_starters ?? 2}
      thirdRoundReversal={!!(mock as any).third_round_reversal}
      currentUserId={user.id}
      players={mappedPlayers}
      initialMockDraft={{
        id: mock.id,
        myDraftPosition: mock.my_draft_position,
        picks: (mock.picks ?? []) as SavedPick[],
        createdAt: mock.created_at,
        status: ((mock as any).status ?? "lobby") as "lobby" | "in_progress" | "complete",
        isShared: true,
        hostId: mock.user_id,
        seats: ((mock as any).seats ?? {}) as MockSeats,
      }}
    />
  );
}
