import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createTournament, finalizeWeekScores, advanceWeek } from "@/actions/scoring";
import { EnterResultsForm } from "./enter-results-form";

export default async function ScoringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, current_week, name")
    .eq("id", id)
    .single();

  if (!league) notFound();
  if (league.commissioner_id !== user.id) redirect(`/league/${id}`);

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, name, week")
    .order("week", { ascending: false });

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, pdga_number, avatar_url")
    .order("name");

  const currentWeekTournaments = (tournaments ?? []).filter((t) => t.week === league.current_week);
  const hasCurrentWeekMatchups = await checkMatchupsExist(supabase, Number(id), league.current_week);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-white text-lg">Commissioner Panel</h2>
            <p className="text-gray-500 text-sm">Week {league.current_week}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Create tournament */}
          <form
            action={async (formData: FormData) => {
              "use server";
              const name = formData.get("tournamentName") as string;
              await createTournament(Number(id), name, league.current_week);
            }}
            className="flex gap-2"
          >
            <input
              name="tournamentName"
              required
              placeholder="Tournament name..."
              className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] w-52"
            />
            <button
              type="submit"
              className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Add Tournament
            </button>
          </form>

          {/* Finalize week */}
          <form action={finalizeWeekScores.bind(null, Number(id), league.current_week)}>
            <button
              type="submit"
              className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold text-sm px-4 py-2 rounded-lg transition"
            >
              Finalize Week {league.current_week} Scores
            </button>
          </form>

          {/* Advance week */}
          <form action={advanceWeek.bind(null, Number(id))}>
            <button
              type="submit"
              className="border border-white/10 hover:border-white/20 text-gray-300 text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              Advance to Week {league.current_week + 1}
            </button>
          </form>
        </div>
      </div>

      {/* Tournaments this week */}
      {currentWeekTournaments.map((tournament) => (
        <div key={tournament.id} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h3 className="font-semibold text-white mb-4">{tournament.name} — Week {tournament.week}</h3>
          <EnterResultsForm
            leagueId={Number(id)}
            tournamentId={tournament.id}
            players={allPlayers ?? []}
          />
        </div>
      ))}

      {currentWeekTournaments.length === 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-8 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">Add a tournament above to start entering results</p>
        </div>
      )}

      {/* Past tournaments */}
      {(tournaments ?? []).filter((t) => t.week < league.current_week).length > 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h3 className="font-semibold text-white mb-4">Past Tournaments</h3>
          <div className="space-y-2">
            {(tournaments ?? [])
              .filter((t) => t.week < league.current_week)
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <p className="text-gray-300 text-sm">{t.name}</p>
                  <span className="text-gray-500 text-xs">Week {t.week}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function checkMatchupsExist(supabase: any, leagueId: number, week: number) {
  const { count } = await supabase
    .from("matchups")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week", week);
  return (count ?? 0) > 0;
}
