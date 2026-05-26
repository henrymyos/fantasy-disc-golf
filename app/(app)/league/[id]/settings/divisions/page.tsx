import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DivisionsEditor } from "@/components/divisions-editor";
import { regenerateMatchupsAction } from "@/actions/matchups";

export default async function DivisionsAndMatchupsPage({
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
    .select("id, commissioner_id")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if (league.commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const { data: membersRaw } = await supabase
    .from("league_members")
    .select("id, team_name, division_name, joined_at")
    .eq("league_id", id)
    .order("joined_at");
  const members = (membersRaw ?? []) as Array<{
    id: number;
    team_name: string;
    division_name: string | null;
  }>;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Divisions & Matchups</h2>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-5">
        <div>
          <p className="text-white font-semibold text-sm mb-3">Team divisions</p>
          <DivisionsEditor leagueId={Number(id)} initialMembers={members} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5">
          <div className="min-w-0">
            <p className="text-white font-medium text-sm">Weekly matchups</p>
            <p className="text-gray-400 text-xs mt-0.5">
              Regenerate the full season schedule from divisions, or edit individual weeks.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href={`/league/${id}/settings/matchups`}
              className="border border-white/10 hover:border-white/30 text-gray-300 text-sm font-medium px-3 py-2 rounded-lg transition"
            >
              Edit matchups
            </Link>
            <form action={regenerateMatchupsAction.bind(null, Number(id))}>
              <button
                type="submit"
                className="bg-[#4B3DFF]/15 hover:bg-[#4B3DFF]/25 border border-[#4B3DFF]/30 text-[#4B3DFF] hover:text-white text-sm font-semibold px-3 py-2 rounded-lg transition"
              >
                Regenerate
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
