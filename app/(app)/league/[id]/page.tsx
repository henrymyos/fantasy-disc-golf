import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { LeagueMember, Matchup } from "@/types";

export default async function LeagueDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, starters_count")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, user_id, is_commissioner, profiles(username)")
    .eq("league_id", id)
    .order("joined_at");

  const { data: matchups } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_score, team2_score, is_final,
      team1:league_members!matchups_team1_id_fkey(id, team_name),
      team2:league_members!matchups_team2_id_fkey(id, team_name)
    `)
    .eq("league_id", id)
    .eq("week", league.current_week);

  // Compute standings from all matchups
  const { data: allMatchups } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score, is_final")
    .eq("league_id", id)
    .eq("is_final", true);

  const winsMap: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m) => { winsMap[m.id] = { wins: 0, losses: 0, points: 0 }; });

  (allMatchups ?? []).forEach((m) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    winsMap[m.team1_id].points += m.team1_score;
    winsMap[m.team2_id].points += m.team2_score;
    if (m.team1_score > m.team2_score) {
      winsMap[m.team1_id].wins++;
      winsMap[m.team2_id].losses++;
    } else if (m.team2_score > m.team1_score) {
      winsMap[m.team2_id].wins++;
      winsMap[m.team1_id].losses++;
    }
  });

  const standings = (members ?? [])
    .map((m) => ({ ...m, ...winsMap[m.id] }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  const myMembership = (members ?? []).find((m) => m.user_id === user.id);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Standings */}
      <div className="lg:col-span-1 bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-4">Standings</h2>
        <div className="space-y-2">
          {standings.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                t.user_id === user.id ? "bg-[#4B3DFF]/15 border border-[#4B3DFF]/30" : "hover:bg-white/3"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-sm w-4">{i + 1}</span>
                <div>
                  <p className="text-white text-sm font-medium">{t.team_name}</p>
                  <p className="text-gray-600 text-xs">{(t.profiles as any)?.username}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white text-sm font-semibold">{t.wins}-{t.losses}</p>
                <p className="text-gray-500 text-xs">{t.points.toFixed(0)} pts</p>
              </div>
            </div>
          ))}
          {standings.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-4">No teams yet</p>
          )}
        </div>
      </div>

      {/* This week's matchups */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h2 className="font-bold text-white mb-4">Week {league.current_week} Matchups</h2>
          {(matchups ?? []).length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">
              No matchups scheduled yet
            </p>
          ) : (
            <div className="space-y-3">
              {(matchups as unknown as Matchup[]).map((m) => (
                <MatchupRow key={m.id} matchup={m} myTeamId={myMembership?.id} />
              ))}
            </div>
          )}
        </div>

        {/* Members */}
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h2 className="font-bold text-white mb-4">Teams ({(members ?? []).length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(members ?? []).map((m) => (
              <div key={m.id} className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-white/3">
                <div className="w-7 h-7 rounded-full bg-[#4B3DFF]/40 flex items-center justify-center text-white text-xs font-bold">
                  {m.team_name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{m.team_name}</p>
                  <p className="text-gray-600 text-xs">{(m.profiles as any)?.username}</p>
                </div>
                {m.is_commissioner && (
                  <span className="ml-auto text-xs text-[#36D7B7]">★</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchupRow({ matchup, myTeamId }: { matchup: Matchup; myTeamId?: number }) {
  const isMyMatchup = matchup.team1_id === myTeamId || matchup.team2_id === myTeamId;
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border ${
      isMyMatchup ? "border-[#4B3DFF]/40 bg-[#4B3DFF]/5" : "border-white/5 bg-[#0f1117]"
    }`}>
      <TeamScore
        name={(matchup.team1 as any)?.team_name ?? "TBD"}
        score={matchup.team1_score}
        isWinner={matchup.is_final && matchup.team1_score > matchup.team2_score}
      />
      <div className="text-center">
        <span className="text-gray-600 text-xs font-medium">{matchup.is_final ? "FINAL" : "vs"}</span>
      </div>
      <TeamScore
        name={(matchup.team2 as any)?.team_name ?? "TBD"}
        score={matchup.team2_score}
        isWinner={matchup.is_final && matchup.team2_score > matchup.team1_score}
        right
      />
    </div>
  );
}

function TeamScore({ name, score, isWinner, right }: { name: string; score: number; isWinner: boolean; right?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
        isWinner ? "bg-[#36D7B7] text-black" : "bg-white/10 text-white"
      }`}>
        {name[0]?.toUpperCase()}
      </div>
      <div className={right ? "text-right" : ""}>
        <p className={`font-semibold text-sm ${isWinner ? "text-white" : "text-gray-400"}`}>{name}</p>
        <p className={`text-lg font-bold ${isWinner ? "text-[#36D7B7]" : "text-white"}`}>{score.toFixed(1)}</p>
      </div>
    </div>
  );
}
