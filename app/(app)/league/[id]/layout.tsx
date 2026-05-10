import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeagueTabNav } from "@/components/league-tab-nav";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, commissioner_id, invite_code")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: membership } = await supabase
    .from("league_members")
    .select("id, is_commissioner")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    redirect("/dashboard");
  }

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", id)
    .single();

  const draftComplete = draft?.status === "complete";
  const base = `/league/${id}`;

  return (
    <div>
      {/* League header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-white font-bold text-xl">{league.name}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Week {league.current_week}</span>
          <span className="border border-white/10 rounded px-2 py-0.5 font-mono text-gray-400">
            {league.invite_code}
          </span>
          {membership.is_commissioner && (
            <Link
              href={`${base}/scoring`}
              className="bg-[#36D7B7]/20 text-[#36D7B7] px-3 py-1 rounded-full hover:bg-[#36D7B7]/30 transition"
            >
              ⚙ Scoring
            </Link>
          )}
        </div>
      </div>

      {/* Tab nav */}
      <LeagueTabNav base={base} isCommissioner={!!membership.is_commissioner} draftComplete={draftComplete} />

      {children}
    </div>
  );
}

