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

  const safeBudget = Math.max(50, Math.min(1000, Math.round(auctionBudget) || 200));
  await admin
    .from("drafts")
    .update({ type, auction_budget: safeBudget })
    .eq("id", draft.id);

  revalidatePath(`/league/${leagueId}/draft`);
}
