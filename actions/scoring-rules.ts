"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScoringRules } from "@/lib/scoring-rules";
import { BONUS_POINTS } from "@/lib/scoring-constants";

export async function saveScoringRules(
  leagueId: number,
  rules: ScoringRules,
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
  if (!league || (league as any).commissioner_id !== user.id) return;

  // Drop overrides that match defaults so we don't bloat the JSON.
  const clean: ScoringRules = {
    mpoPositionPoints: rules.mpoPositionPoints && Object.keys(rules.mpoPositionPoints).length > 0
      ? rules.mpoPositionPoints
      : null,
    fpoPositionPoints: rules.fpoPositionPoints && Object.keys(rules.fpoPositionPoints).length > 0
      ? rules.fpoPositionPoints
      : null,
    bonusPoints: {
      hotRound: Number(rules.bonusPoints.hotRound),
      bogeyFree: Number(rules.bonusPoints.bogeyFree),
      ace: Number(rules.bonusPoints.ace),
      birdie: Number(rules.bonusPoints.birdie ?? BONUS_POINTS.birdie),
      bogey: Number(rules.bonusPoints.bogey ?? BONUS_POINTS.bogey),
      eagle: Number(rules.bonusPoints.eagle ?? BONUS_POINTS.eagle),
    },
  };

  await admin.from("leagues").update({ scoring_rules: clean }).eq("id", leagueId);
  revalidatePath(`/league/${leagueId}/settings/scoring`);
  revalidatePath(`/league/${leagueId}`);
}

export async function resetScoringRules(leagueId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league || (league as any).commissioner_id !== user.id) return;

  await admin.from("leagues").update({ scoring_rules: null }).eq("id", leagueId);
  revalidatePath(`/league/${leagueId}/settings/scoring`);
}
