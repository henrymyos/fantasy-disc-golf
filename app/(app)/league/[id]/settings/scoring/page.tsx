import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScoringRules } from "@/components/scoring-rules";
import { ScoringRulesPanel } from "@/components/scoring-rules-panel";
import { resolveScoringRules } from "@/lib/scoring-rules";

export default async function ScoringPage({
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
    .select("id, mpo_starters, fpo_starters, commissioner_id, scoring_rules")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const isCommissioner = (league as any).commissioner_id === user.id;
  const rules = resolveScoringRules((league as any).scoring_rules);
  const mpoStarters = (league as any).mpo_starters ?? 4;
  const fpoStarters = (league as any).fpo_starters ?? 2;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Scoring</h2>
        <p className="text-gray-400 text-sm mt-1">
          {isCommissioner
            ? "Tune position points and bonus values. The graphic above the editor updates live as you type; saving applies the new rules to standings and weekly results."
            : "Position points and bonus values are set by the commissioner."}
        </p>
      </div>

      {isCommissioner ? (
        <ScoringRulesPanel
          leagueId={Number(id)}
          initialRules={rules}
          mpoStarters={mpoStarters}
          fpoStarters={fpoStarters}
        />
      ) : (
        <div className="bg-[#1a1d23] rounded-2xl p-4 sm:p-6 border border-white/5">
          <ScoringRules
            mpoStarters={mpoStarters}
            fpoStarters={fpoStarters}
            rules={rules}
          />
        </div>
      )}
    </div>
  );
}
