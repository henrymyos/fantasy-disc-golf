import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DuesEditor } from "@/components/dues-editor";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { stripeEnabled } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function DuesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, dues_amount, payout_splits, scoring_mode")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if ((league as any).commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, dues_paid, dues_paid_at")
    .eq("league_id", id)
    .order("joined_at");

  // Compute current standings to power the projected-payout preview.
  const scoringMode = (((league as any).scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const wins: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m: any) => { wins[m.id] = { wins: 0, losses: 0, points: 0 }; });

  const { data: finals } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score")
    .eq("league_id", id)
    .eq("is_final", true);
  (finals ?? []).forEach((m: any) => {
    if (!wins[m.team1_id]) wins[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!wins[m.team2_id]) wins[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    wins[m.team1_id].points += Number(m.team1_score);
    wins[m.team2_id].points += Number(m.team2_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) {
        wins[m.team1_id].wins++;
        wins[m.team2_id].losses++;
      } else if (m.team2_score > m.team1_score) {
        wins[m.team2_id].wins++;
        wins[m.team1_id].losses++;
      }
    }
  });
  if (scoringMode !== "head_to_head") {
    const weekly = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weekly, scoringMode);
    for (const [tid, rec] of alt) {
      if (!wins[tid]) wins[tid] = { wins: 0, losses: 0, points: 0 };
      wins[tid].wins = rec.wins;
      wins[tid].losses = rec.losses;
    }
  }

  const standings = (members ?? [])
    .map((m: any) => ({
      teamId: m.id,
      teamName: m.team_name,
      wins: wins[m.id]?.wins ?? 0,
      points: wins[m.id]?.points ?? 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Dues &amp; Payouts</h2>
        <p className="text-gray-400 text-sm mt-1">
          Track who&apos;s paid in and how the pot splits at the end of the season.
        </p>
        <p className="text-xs mt-2">
          {stripeEnabled() ? (
            <span className="text-[#36D7B7]">● Online card payments are on — members can pay their dues from the league home, and it marks them paid automatically.</span>
          ) : (
            <span className="text-gray-500">○ Online payments are off (manual tracking). Set Stripe keys to let members pay by card.</span>
          )}
        </p>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <DuesEditor
          leagueId={Number(id)}
          initialDuesAmount={Number((league as any).dues_amount ?? 0)}
          initialPayoutSplits={(league as any).payout_splits ?? []}
          members={(members ?? []).map((m: any) => ({
            id: m.id,
            team_name: m.team_name,
            dues_paid: !!m.dues_paid,
            dues_paid_at: m.dues_paid_at ?? null,
          }))}
          standings={standings}
        />
      </div>
    </div>
  );
}
