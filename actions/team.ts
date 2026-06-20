"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export type TeamActionState = { error?: string; ok?: boolean } | null;

const NameSchema = z.string().min(1, "Team name is required").max(30).trim();

/**
 * Updates the caller's team name and per-player nicknames for the given league.
 * Nicknames arrive as `nickname_<playerId>` form fields; an empty value clears
 * that player's nickname. Only the player's own roster is touched.
 */
export async function updateTeamSettings(
  leagueId: number,
  formData: FormData,
): Promise<TeamActionState> {
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
  if (!member) return { error: "You're not in this league." };

  const nameResult = NameSchema.safeParse(formData.get("teamName"));
  if (!nameResult.success) {
    return { error: nameResult.error.issues[0]?.message ?? "Invalid team name" };
  }

  const { error: nameError } = await admin
    .from("league_members")
    .update({ team_name: nameResult.data })
    .eq("id", member.id);
  if (nameError) return { error: nameError.message };

  // Which players are actually on this team — only accept nicknames for those.
  const { data: roster } = await admin
    .from("rosters")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("team_id", member.id);
  const ownPlayerIds = new Set((roster ?? []).map((r: any) => r.player_id as number));

  const toUpsert: { league_id: number; team_id: number; player_id: number; nickname: string }[] = [];
  const toClear: number[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("nickname_")) continue;
    const playerId = Number(key.slice("nickname_".length));
    if (!Number.isFinite(playerId) || !ownPlayerIds.has(playerId)) continue;
    const nickname = String(value).trim().slice(0, 24);
    if (nickname) toUpsert.push({ league_id: leagueId, team_id: member.id, player_id: playerId, nickname });
    else toClear.push(playerId);
  }

  if (toUpsert.length > 0) {
    const { error } = await admin
      .from("player_nicknames")
      .upsert(toUpsert, { onConflict: "team_id,player_id" });
    if (error) return { error: error.message };
  }
  if (toClear.length > 0) {
    await admin
      .from("player_nicknames")
      .delete()
      .eq("team_id", member.id)
      .in("player_id", toClear);
  }

  revalidatePath(`/league/${leagueId}`, "layout");
  return { ok: true };
}
