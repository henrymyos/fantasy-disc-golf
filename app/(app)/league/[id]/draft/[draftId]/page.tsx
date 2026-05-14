import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DraftBoard } from "@/components/draft-board";

export default async function DraftResultPage({
  params,
}: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const { id, draftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Must be a league member
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!member) redirect(`/league/${id}`);

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick, total_rounds")
    .eq("id", draftId)
    .eq("league_id", id)
    .single();

  if (!draft || draft.status !== "complete") notFound();

  const { data: leagueSlotRow } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters, roster_size")
    .eq("id", id)
    .single();
  const mpoSlots: number = (leagueSlotRow as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (leagueSlotRow as any)?.fpo_starters ?? 2;
  const rosterSize: number = (leagueSlotRow as any)?.roster_size ?? 14;

  const { data: memberRows } = await supabase
    .from("league_members")
    .select("id, team_name, draft_position")
    .eq("league_id", id)
    .not("draft_position", "is", null)
    .order("draft_position");

  const { data: pickRows } = await supabase
    .from("draft_picks")
    .select("pick_number, team_id, players(name, division)")
    .eq("draft_id", draft.id)
    .order("pick_number");

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

  return (
    <DraftBoard
      leagueId={Number(id)}
      draft={{ id: draft.id, status: draft.status, currentPick: draft.current_pick, totalRounds: draft.total_rounds }}
      members={members}
      picks={picks}
      availablePlayers={[]}
      myMemberId={member.id}
      isCommissioner={false}
      mpoSlots={mpoSlots}
      fpoSlots={fpoSlots}
      rosterSize={rosterSize}
      readOnly
    />
  );
}
