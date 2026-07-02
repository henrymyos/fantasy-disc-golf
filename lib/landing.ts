import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Where a signed-in user should land when they open the app. Preference order:
 *   1. The league they were most recently in (the `last_league_id` cookie set
 *      by RememberLastLeague), as long as they're still a member.
 *   2. Their most recently joined league.
 *   3. The dashboard — only when they aren't in any league yet.
 */
export async function landingPathForUser(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });

  const rows = memberships ?? [];
  if (rows.length === 0) return "/dashboard";

  const memberLeagueIds = new Set(rows.map((m: { league_id: number }) => String(m.league_id)));
  const cookieStore = await cookies();
  const last = cookieStore.get("last_league_id")?.value;
  if (last && memberLeagueIds.has(last)) return `/league/${last}`;

  return `/league/${rows[0].league_id}`;
}
