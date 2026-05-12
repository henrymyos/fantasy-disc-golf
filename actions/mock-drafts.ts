"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SavedPick = {
  pickNumber: number;
  teamIndex: number;
  playerId: number | null;
};

export async function saveMockDraft(
  leagueId: string,
  payload: {
    myDraftPosition: number;
    numTeams: number;
    rosterSize: number;
    picks: SavedPick[];
  }
): Promise<{ id: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Confirm membership in this league
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("Not a member of this league");

  const { data, error } = await admin
    .from("mock_drafts")
    .insert({
      user_id: user.id,
      league_id: Number(leagueId),
      my_draft_position: payload.myDraftPosition,
      num_teams: payload.numTeams,
      roster_size: payload.rosterSize,
      picks: payload.picks,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}/mock-draft`);
  return { id: data.id };
}

export async function deleteMockDraft(leagueId: string, mockDraftId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Only the owner can delete
  const { data: row } = await admin
    .from("mock_drafts")
    .select("user_id")
    .eq("id", mockDraftId)
    .single();
  if (!row || row.user_id !== user.id) throw new Error("Not authorized");

  await admin.from("mock_drafts").delete().eq("id", mockDraftId);

  revalidatePath(`/league/${leagueId}/mock-draft`);
}
