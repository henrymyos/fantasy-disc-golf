import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MockDraft } from "@/components/mock-draft";

type SavedPick = { pickNumber: number; teamIndex: number; playerId: number | null };

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
    .select("id, user_id, league_id, my_draft_position, num_teams, roster_size, picks, created_at")
    .eq("id", Number(mockDraftId))
    .single();

  if (!mock || mock.user_id !== user.id || String(mock.league_id) !== id) notFound();

  const { data: players } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false });

  return (
    <MockDraft
      leagueId={id}
      leagueName={league.name}
      numTeams={mock.num_teams}
      rosterSize={mock.roster_size}
      mpoStarters={(league as any).mpo_starters ?? 4}
      fpoStarters={(league as any).fpo_starters ?? 2}
      players={(players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        division: p.division as "MPO" | "FPO",
        worldRanking: p.world_ranking as number | null,
        overallRank: (p as any).overall_rank as number | null,
      }))}
      initialMockDraft={{
        id: mock.id,
        myDraftPosition: mock.my_draft_position,
        picks: (mock.picks ?? []) as SavedPick[],
        createdAt: mock.created_at,
      }}
    />
  );
}
