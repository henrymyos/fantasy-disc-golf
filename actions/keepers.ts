"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Replace this team's keeper picks for the given season. */
export async function setKeepers(
  leagueId: number,
  seasonYear: number,
  playerIds: number[],
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member) return;

  const { data: league } = await admin
    .from("leagues")
    .select("keepers_per_team")
    .eq("id", leagueId)
    .single();
  const limit = (league as any)?.keepers_per_team ?? 0;
  const cleaned = Array.from(new Set(playerIds)).slice(0, limit);

  // Each player must currently be on this team.
  const { data: roster } = await admin
    .from("rosters")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("team_id", member.id);
  const owned = new Set((roster ?? []).map((r: any) => r.player_id));
  const valid = cleaned.filter((id) => owned.has(id));

  await admin
    .from("keeper_picks")
    .delete()
    .eq("league_id", leagueId)
    .eq("season_year", seasonYear)
    .eq("team_id", member.id);

  if (valid.length > 0) {
    await admin.from("keeper_picks").insert(
      valid.map((pid) => ({
        league_id: leagueId,
        season_year: seasonYear,
        team_id: member.id,
        player_id: pid,
      })),
    );
  }

  revalidatePath(`/league/${leagueId}/settings/keepers`);
  revalidatePath(`/league/${leagueId}`);
}
