import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPollableTournament } from "@/lib/live-window";
import { featuredWeekFor, getLeagueSchedule, weekTabsFor } from "@/lib/league-schedule";
import { buildSeasonSchedule } from "@/lib/matchup-scheduler";
import { LiveScoreRefresher } from "@/components/live-score-refresher";
import { WeekSwitcher } from "@/components/week-switcher";
import { buildWeekProjections } from "@/lib/matchup-projections";

export default async function MatchupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, current_week, scoring_rules, mpo_starters, fpo_starters")
    .eq("id", id)
    .single();

  if (!league) notFound();

  // ── Week selection: any week in the season, default the featured week ──────
  const schedule = await getLeagueSchedule(supabase, Number(id));
  const totalWeeks = schedule?.weeks.length ?? league.current_week;
  const currentWeek = Math.min(league.current_week, Math.max(totalWeeks, 1));
  const featured = schedule
    ? featuredWeekFor(schedule, league.current_week)
    : league.current_week;
  const requested = Number(sp.week);
  const selectedWeek =
    Number.isInteger(requested) && requested >= 1 && requested <= totalWeeks
      ? requested
      : Math.min(Math.max(featured, 1), totalWeeks);
  const weekTabs = schedule ? weekTabsFor(schedule) : [];
  const scheduleWeek = schedule?.weeks.find((w) => w.week === selectedWeek) ?? null;

  const { data: weekMatchups } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_id, team2_id, team1_score, team2_score, is_final,
      team1:league_members!matchups_team1_id_fkey(id, team_name, user_id, profiles(avatar_url, avatar_color)),
      team2:league_members!matchups_team2_id_fkey(id, team_name, user_id, profiles(avatar_url, avatar_color))
    `)
    .eq("league_id", id)
    .eq("week", selectedWeek);

  // Live or recently-ended: keeps the score poller running through the
  // post-event grace window (see lib/live-window.ts).
  const pollableTournament = await getPollableTournament(supabase, Number(id));

  // Every team's numbers for the SELECTED week, from the same helper the
  // matchup detail page uses — so a card here and the matchup it links to
  // always show the same projection and win %.
  const wk = await buildWeekProjections(supabase, {
    leagueId: Number(id),
    week: selectedWeek,
    schedule,
    league: league as any,
  });

  const { data: myMembership } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  // Future regular-season weeks without scheduled rows yet: derive the
  // pairings from the same round-robin the week-advance uses, so members can
  // scout upcoming opponents. These cards aren't clickable (no matchup row).
  let displayMatchups: any[] = weekMatchups ?? [];
  let isProjectedPairings = false;
  const isPlayoffWeek = scheduleWeek?.isPlayoff ?? false;
  if (
    displayMatchups.length === 0 &&
    selectedWeek > currentWeek &&
    schedule != null &&
    selectedWeek <= schedule.regularWeeks
  ) {
    const { data: members } = await supabase
      .from("league_members")
      .select("id, team_name, division_name, profiles(avatar_url, avatar_color)")
      .eq("league_id", id)
      .order("joined_at");
    if (members && members.length >= 2) {
      const season = buildSeasonSchedule(
        members.map((m: any) => ({ id: m.id, divisionName: m.division_name })),
        selectedWeek,
      );
      const wk = season.find((s) => s.week === selectedWeek);
      const memberById = new Map<number, any>((members ?? []).map((m: any) => [m.id, m]));
      displayMatchups = (wk?.pairs ?? []).map(([t1, t2], i) => ({
        id: null,
        key: `proj-${i}`,
        week: selectedWeek,
        team1_id: t1,
        team2_id: t2,
        team1_score: 0,
        team2_score: 0,
        is_final: false,
        team1: memberById.get(t1),
        team2: memberById.get(t2),
      }));
      isProjectedPairings = displayMatchups.length > 0;
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {weekTabs.length > 0 && (
        <WeekSwitcher
          basePath={`/league/${id}/matchups`}
          weeks={weekTabs}
          selected={selectedWeek}
          currentWeek={currentWeek}
        />
      )}

      {pollableTournament && selectedWeek === currentWeek && (
        <LiveScoreRefresher tournamentName={pollableTournament.name} />
      )}

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-semibold text-gray-400 text-sm mb-4 uppercase tracking-wide">
          Week {selectedWeek}
          {scheduleWeek && (
            <span className="text-gray-500 normal-case tracking-normal"> · {scheduleWeek.event.name}</span>
          )}{" "}
          {selectedWeek === currentWeek ? <span className="text-[#36D7B7]">• Current</span> : ""}
          {isProjectedPairings ? <span className="text-gray-500 normal-case tracking-normal">• projected pairings</span> : ""}
        </h2>
        <div className="space-y-3">
          {displayMatchups.length === 0 ? (
            <p className="text-gray-400 text-sm">
              {isPlayoffWeek
                ? "Playoff week — matchups are set once the bracket is decided."
                : "No matchups scheduled for this week."}
            </p>
          ) : (
            displayMatchups.map((m) => {
              const t1 = m.team1 as any;
              const t2 = m.team2 as any;
              const isMine = t1?.id === myMembership?.id || t2?.id === myMembership?.id;
              const n1 = wk.teamNumbers(m.team1_id);
              const n2 = wk.teamNumbers(m.team2_id);
              // The week's event has scores on the board → the card shows them
              // live/unofficial; otherwise the stored (finalized) score.
              const live = !m.is_final && wk.hasActuals && (wk.inProgress || wk.settled);
              const score1 = m.is_final ? m.team1_score : live ? n1.actual : m.team1_score;
              const score2 = m.is_final ? m.team2_score : live ? n2.actual : m.team2_score;
              // Second line: the finishing estimate — pre-event projection,
              // live pace, or the real result once settled (same as the
              // matchup page's line under each score).
              const proj1 = n1.finishing;
              const proj2 = n2.finishing;
              const showFinishing = !m.is_final && !wk.settled && (proj1 > 0 || proj2 > 0);
              const win1 = wk.winPctFor(m.team1_id, m.team2_id);
              const win2 = 100 - win1;
              const card = (
                <>
                  <div className="flex items-center gap-3">
                    {(t1 as any)?.profiles?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={(t1 as any).profiles.avatar_url}
                        alt=""
                        className={`w-9 h-9 rounded-full object-cover shrink-0 bg-white/10 ${
                          m.is_final && m.team1_score > m.team2_score ? "ring-2 ring-[#36D7B7]" : ""
                        }`}
                      />
                    ) : (
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          m.is_final && m.team1_score > m.team2_score ? "bg-[#36D7B7] text-black" : "text-white"
                        }`}
                        style={
                          m.is_final && m.team1_score > m.team2_score
                            ? undefined
                            : { backgroundColor: (t1 as any)?.profiles?.avatar_color ?? "rgba(255,255,255,0.1)" }
                        }
                      >
                        {t1?.team_name?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-white text-sm font-medium">{t1?.team_name}</p>
                      <p className="text-xl font-bold text-white">{score1.toFixed(1)}</p>
                      {!m.is_final && (
                        <p className="text-gray-400 text-xs">
                          {showFinishing && <>{proj1.toFixed(1)} · </>}
                          <span className={win1 >= win2 ? "text-white font-semibold" : ""}>{win1}%</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="text-gray-400 text-xs font-medium">
                    {m.is_final ? "FINAL" : wk.settled && live ? "UNOFFICIAL" : live ? "LIVE" : "vs"}
                  </span>

                  <div className="flex items-center gap-3 flex-row-reverse">
                    {(t2 as any)?.profiles?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={(t2 as any).profiles.avatar_url}
                        alt=""
                        className={`w-9 h-9 rounded-full object-cover shrink-0 bg-white/10 ${
                          m.is_final && m.team2_score > m.team1_score ? "ring-2 ring-[#36D7B7]" : ""
                        }`}
                      />
                    ) : (
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          m.is_final && m.team2_score > m.team1_score ? "bg-[#36D7B7] text-black" : "text-white"
                        }`}
                        style={
                          m.is_final && m.team2_score > m.team1_score
                            ? undefined
                            : { backgroundColor: (t2 as any)?.profiles?.avatar_color ?? "rgba(255,255,255,0.1)" }
                        }
                      >
                        {t2?.team_name?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-white text-sm font-medium">{t2?.team_name}</p>
                      <p className="text-xl font-bold text-white">{score2.toFixed(1)}</p>
                      {!m.is_final && (
                        <p className="text-gray-400 text-xs">
                          {showFinishing && <>{proj2.toFixed(1)} · </>}
                          <span className={win2 > win1 ? "text-white font-semibold" : ""}>{win2}%</span>
                        </p>
                      )}
                    </div>
                  </div>
                </>
              );
              const cardClass = `flex items-center justify-between p-4 rounded-xl border transition ${
                isMine ? "border-[#4B3DFF]/40 bg-[#4B3DFF]/5" : "border-white/5 bg-[#0f1117]"
              }`;
              return m.id != null ? (
                <Link key={m.id} href={`/league/${id}/matchups/${m.id}`} className={`${cardClass} hover:bg-white/[0.03]`}>
                  {card}
                </Link>
              ) : (
                <div key={m.key} className={cardClass}>
                  {card}
                </div>
              );
            })
          )}
        </div>
      </div>

      {weekTabs.length === 0 && (weekMatchups ?? []).length === 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">No matchups yet. The commissioner schedules matchups in the Scoring panel.</p>
        </div>
      )}
    </div>
  );
}
