"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Star/unstar a player on the caller's Players-tab watchlist. */
export async function toggleWatchlist(
  leagueId: number,
  playerId: number,
): Promise<{ ok: boolean; starred: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { ok: false, starred: false };

  try {
    const { data: existing, error: selErr } = await admin
      .from("player_watchlist")
      .select("id")
      .eq("team_id", member.id)
      .eq("player_id", playerId)
      .maybeSingle();
    if (selErr) return { ok: false, starred: false };
    if (existing) {
      await admin.from("player_watchlist").delete().eq("id", (existing as any).id);
      return { ok: true, starred: false };
    }
    const { error } = await admin
      .from("player_watchlist")
      .insert({ league_id: leagueId, team_id: member.id, player_id: playerId });
    return { ok: !error, starred: !error };
  } catch {
    return { ok: false, starred: false };
  }
}
