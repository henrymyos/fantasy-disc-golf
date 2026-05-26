import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScoringRules } from "@/components/scoring-rules";

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
    .select("id, mpo_starters, fpo_starters")
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

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Scoring</h2>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-4 sm:p-6 border border-white/5">
        <ScoringRules
          mpoStarters={(league as any).mpo_starters ?? 4}
          fpoStarters={(league as any).fpo_starters ?? 2}
        />
      </div>
    </div>
  );
}
