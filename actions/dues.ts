"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PayoutSplit } from "@/lib/dues-types";

async function requireCommissioner(leagueId: number, userId: string) {
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  return !!(league && (league as any).commissioner_id === userId);
}

export async function saveDuesConfig(
  leagueId: number,
  duesAmount: number,
  payoutSplits: PayoutSplit[],
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await requireCommissioner(leagueId, user.id))) return;

  const admin = createAdminClient();
  const clean = payoutSplits
    .filter((s) => Number.isFinite(s.place) && Number.isFinite(s.pct) && s.pct > 0)
    .map((s) => ({ place: Number(s.place), pct: Number(s.pct) }))
    .sort((a, b) => a.place - b.place);

  await admin
    .from("leagues")
    .update({ dues_amount: duesAmount, payout_splits: clean })
    .eq("id", leagueId);

  revalidatePath(`/league/${leagueId}/settings/dues`);
}

export async function setTeamDuesPaid(
  leagueId: number,
  teamId: number,
  paid: boolean,
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await requireCommissioner(leagueId, user.id))) return;

  const admin = createAdminClient();
  await admin
    .from("league_members")
    .update({
      dues_paid: paid,
      dues_paid_at: paid ? new Date().toISOString() : null,
    })
    .eq("id", teamId)
    .eq("league_id", leagueId);

  revalidatePath(`/league/${leagueId}/settings/dues`);
}
