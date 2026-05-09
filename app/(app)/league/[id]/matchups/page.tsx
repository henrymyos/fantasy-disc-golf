import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function MatchupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, current_week")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const weeks = Array.from({ length: league.current_week }, (_, i) => i + 1).reverse();

  const { data: allMatchups } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_score, team2_score, is_final,
      team1:league_members!matchups_team1_id_fkey(id, team_name, user_id),
      team2:league_members!matchups_team2_id_fkey(id, team_name, user_id)
    `)
    .eq("league_id", id)
    .order("week", { ascending: false });

  const byWeek: Record<number, typeof allMatchups> = {};
  (allMatchups ?? []).forEach((m) => {
    if (!byWeek[m.week]) byWeek[m.week] = [];
    byWeek[m.week]!.push(m);
  });

  const { data: myMembership } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  return (
    <div className="max-w-2xl space-y-6">
      {weeks.map((week) => (
        <div key={week} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h2 className="font-semibold text-gray-400 text-sm mb-4 uppercase tracking-wide">
            Week {week} {week === league.current_week ? <span className="text-[#36D7B7]">• Current</span> : ""}
          </h2>
          <div className="space-y-3">
            {(byWeek[week] ?? []).length === 0 ? (
              <p className="text-gray-600 text-sm">No matchups scheduled</p>
            ) : (
              (byWeek[week] ?? []).map((m) => {
                const t1 = m.team1 as any;
                const t2 = m.team2 as any;
                const isMine = t1?.id === myMembership?.id || t2?.id === myMembership?.id;
                return (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between p-4 rounded-xl border ${
                      isMine ? "border-[#4B3DFF]/40 bg-[#4B3DFF]/5" : "border-white/5 bg-[#0f1117]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                        m.is_final && m.team1_score > m.team2_score ? "bg-[#36D7B7] text-black" : "bg-white/10 text-white"
                      }`}>
                        {t1?.team_name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{t1?.team_name}</p>
                        <p className="text-xl font-bold text-white">{m.team1_score.toFixed(1)}</p>
                      </div>
                    </div>

                    <span className="text-gray-600 text-xs font-medium">
                      {m.is_final ? "FINAL" : "vs"}
                    </span>

                    <div className="flex items-center gap-3 flex-row-reverse">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                        m.is_final && m.team2_score > m.team1_score ? "bg-[#36D7B7] text-black" : "bg-white/10 text-white"
                      }`}>
                        {t2?.team_name?.[0]?.toUpperCase()}
                      </div>
                      <div className="text-right">
                        <p className="text-white text-sm font-medium">{t2?.team_name}</p>
                        <p className="text-xl font-bold text-white">{m.team2_score.toFixed(1)}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}

      {weeks.length === 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">No matchups yet. The commissioner schedules matchups in the Scoring panel.</p>
        </div>
      )}
    </div>
  );
}
