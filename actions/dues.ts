"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PayoutSplit } from "@/lib/dues-types";
import { stripeEnabled, createDuesCheckoutSession } from "@/lib/stripe";

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

/**
 * Member self-serve dues payment. Creates a Stripe Checkout session for the
 * caller's own membership and redirects them to Stripe's hosted page. The
 * webhook flips dues_paid on completion. No-op (returns) if Stripe isn't
 * configured or there's nothing to pay.
 */
export async function createDuesCheckout(leagueId: number): Promise<void> {
  if (!stripeEnabled()) return;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("id, name, dues_amount")
    .eq("id", leagueId)
    .single();
  const amount = Number((league as any)?.dues_amount ?? 0);
  if (!league || !(amount > 0)) return;

  const { data: member } = await admin
    .from("league_members")
    .select("id, dues_paid")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .single();
  if (!member || (member as any).dues_paid) return;

  const url = await createDuesCheckoutSession({
    leagueId,
    memberId: (member as any).id,
    leagueName: (league as any).name,
    amountDollars: amount,
  });

  redirect(url);
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
