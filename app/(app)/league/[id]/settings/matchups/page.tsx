import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MatchupsEditor } from "@/components/matchups-editor";

export default async function EditMatchupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, commissioner_id, current_week")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if (league.commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, division_name, joined_at")
    .eq("league_id", id)
    .order("joined_at");

  const { data: matchups } = await supabase
    .from("matchups")
    .select("id, week, team1_id, team2_id, is_final")
    .eq("league_id", id)
    .order("week", { ascending: true })
    .order("id", { ascending: true });

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Edit Matchups</h2>
        <p className="text-gray-400 text-sm mt-1">
          Swap teams for any future week. Finalized matchups are locked.
        </p>
      </div>

      <MatchupsEditor
        leagueId={Number(id)}
        currentWeek={league.current_week}
        members={(members ?? []).map((m: any) => ({
          id: m.id,
          team_name: m.team_name,
          division_name: m.division_name,
        }))}
        matchups={(matchups ?? []).map((m: any) => ({
          id: m.id,
          week: m.week,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          is_final: !!m.is_final,
        }))}
      />
    </div>
  );
}
