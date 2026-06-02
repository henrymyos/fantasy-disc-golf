"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Commissioner sets the draft type (snake | auction) + auction budget. Only
 *  allowed while the draft is still pending. */
export async function setDraftConfig(
  leagueId: number,
  type: "snake" | "auction",
  auctionBudget: number,
  thirdRoundReversal = false,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  const { data: draft } = await admin
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "pending") return;

  // Auction budget is a fixed choice between $100 and $200.
  const safeBudget = auctionBudget === 100 ? 100 : 200;
  // 3RR only applies to snake; auction drafts always store false.
  const effective3rr = type === "snake" ? !!thirdRoundReversal : false;
  await admin
    .from("drafts")
    .update({
      type,
      auction_budget: safeBudget,
      third_round_reversal: effective3rr,
    })
    .eq("id", draft.id);

  revalidatePath(`/league/${leagueId}/draft`);
}

/** Commissioner sets the per-pick timer in seconds. Picks that exceed this
 *  duration auto-fire to the top available player. */
export async function setSecondsPerPick(leagueId: number, seconds: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || league.commissioner_id !== user.id) return;

  // Allowed range: 10 seconds to 7 days (covers everything from speed drafts
  // to multi-day async drafts). Falls back to 60s if the value is missing/garbage.
  const safe = Math.max(10, Math.min(7 * 24 * 60 * 60, Math.round(seconds) || 60));
  await admin.from("drafts").update({ seconds_per_pick: safe }).eq("league_id", leagueId);

  revalidatePath(`/league/${leagueId}/draft`);
}
