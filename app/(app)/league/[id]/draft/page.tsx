import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DraftBoard } from "@/components/draft-board";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, draft_status")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const isCommissioner = league.commissioner_id === user.id;

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick, total_rounds")
    .eq("league_id", id)
    .single();

  const { data: memberRows } = await supabase
    .from("league_members")
    .select("id, team_name, draft_position")
    .eq("league_id", id)
    .not("draft_position", "is", null)
    .order("draft_position");

  const { data: myMemberRow } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  const { data: pickRows } = await supabase
    .from("draft_picks")
    .select("pick_number, team_id, players(name, division)")
    .eq("draft_id", draft?.id ?? 0)
    .order("pick_number");

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const draftedIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank");

  const members = (memberRows ?? []).map((m) => ({
    id: m.id,
    teamName: m.team_name,
    draftPosition: m.draft_position as number,
  }));

  const picks = (pickRows ?? []).map((p: any) => ({
    pickNumber: p.pick_number,
    teamId: p.team_id,
    playerName: p.players?.name ?? "",
    playerDivision: p.players?.division ?? "MPO",
  }));

  const availablePlayers = (allPlayers ?? [])
    .filter((p) => !draftedIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      division: p.division,
      worldRanking: p.world_ranking,
      overallRank: p.overall_rank,
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link
          href={`/league/${id}/mock-draft`}
          className="flex items-center gap-2 text-sm bg-[#4B3DFF]/15 hover:bg-[#4B3DFF]/25 border border-[#4B3DFF]/30 text-[#4B3DFF] hover:text-white font-semibold px-3 py-1.5 rounded-lg transition"
        >
          <span>🎯</span>
          <span>Mock Draft</span>
        </Link>
      </div>
      <DraftBoard
        leagueId={Number(id)}
        draft={draft ? { id: draft.id, status: draft.status, currentPick: draft.current_pick, totalRounds: draft.total_rounds } : null}
        members={members}
        picks={picks}
        availablePlayers={availablePlayers}
        myMemberId={myMemberRow?.id ?? null}
        isCommissioner={isCommissioner}
      />
    </div>
  );
}
