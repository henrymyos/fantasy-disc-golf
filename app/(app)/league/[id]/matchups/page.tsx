import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTournament } from "@/lib/lineup-lock";
import { getPollableTournament } from "@/lib/live-window";
import { featuredWeekFor, getLeagueSchedule, weekTabsFor } from "@/lib/league-schedule";
import { buildSeasonSchedule } from "@/lib/matchup-scheduler";
import { LiveScoreRefresher } from "@/components/live-score-refresher";
import { WeekSwitcher } from "@/components/week-switcher";
import { applyProjectionVariance, winProbability } from "@/lib/projections";
import { fantasyPointsFromResult, resolveScoringRules } from "@/lib/scoring-rules";

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
    .select("id, current_week, scoring_rules")
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

  const activeTournament = await getActiveTournament(supabase, Number(id));
  // Live or recently-ended: keeps the score poller running through the
  // post-event grace window (see lib/live-window.ts).
  const pollableTournament = await getPollableTournament(supabase, Number(id));

  // Project every team against the SELECTED week's event under this league's
  // scoring rules, with players not registered for that event contributing 0.
  const today = new Date().toISOString().slice(0, 10);
  const targetTournamentId: number | null =
    scheduleWeek?.tournamentIds[0] ??
    (selectedWeek === currentWeek
      ? activeTournament?.id ??
        (schedule?.weeks ?? []).find((w) => w.endDate >= today && w.tournamentIds.length > 0)
          ?.tournamentIds[0] ??
        null
      : null);
  let registeredSet: Set<number> | null = null;
  if (targetTournamentId != null) {
    const { data: regRow } = await supabase
      .from("tournaments")
      .select("registered_player_ids")
      .eq("id", targetTournamentId)
      .maybeSingle();
    const ids = (regRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) registeredSet = new Set(ids);
  }

  const rules = resolveScoringRules((league as any).scoring_rules);
  const projectedByTeam = new Map<number, number>();
  const { data: starters } = await supabase
    .from("rosters")
    .select("team_id, player_id")
    .eq("league_id", id)
    .eq("is_starter", true);
  const starterPlayerIds = [...new Set((starters ?? []).map((s: any) => s.player_id as number))];
  const { data: allResults } = starterPlayerIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
        .in("player_id", starterPlayerIds)
    : { data: [] as any[] };
  const totalByPlayer = new Map<number, { sum: number; count: number }>();
  // Actual points per player per event, so weeks whose event has started show
  // real scores on the cards instead of the stored 0.0 (which only updates at
  // the Monday finalize).
  const ptsByTournamentPlayer = new Map<number, Map<number, number>>();
  (allResults ?? []).forEach((r: any) => {
    const pts = fantasyPointsFromResult(rules, {
      finishing_position: r.finishing_position,
      hot_round_count: r.hot_round_count,
      bogey_free_count: r.bogey_free_count,
      ace_count: r.ace_count,
      under_par_strokes: r.under_par_strokes,
      over_par_strokes: r.over_par_strokes,
      eagle_count: r.eagle_count,
      division: r.players?.division ?? "MPO",
    });
    const cur = totalByPlayer.get(r.player_id) ?? { sum: 0, count: 0 };
    cur.sum += pts;
    cur.count += 1;
    totalByPlayer.set(r.player_id, cur);
    const tid = r.tournament_id as number;
    if (!ptsByTournamentPlayer.has(tid)) ptsByTournamentPlayer.set(tid, new Map());
    const byPlayer = ptsByTournamentPlayer.get(tid)!;
    byPlayer.set(r.player_id, (byPlayer.get(r.player_id) ?? 0) + pts);
  });
  const startersByTeam = new Map<number, number[]>();
  for (const s of starters ?? []) {
    const teamId = (s as any).team_id as number;
    if (!startersByTeam.has(teamId)) startersByTeam.set(teamId, []);
    startersByTeam.get(teamId)!.push((s as any).player_id as number);
  }

  // Live/unofficial scores for a non-final matchup whose week's event has
  // begun: sum each team's starters' actual points for that event. Returns
  // null when the event hasn't started or has no scores yet (fall back to
  // projections).
  const liveScoreFor = (m: { week: number; team1_id: number; team2_id: number }) => {
    const w = (schedule?.weeks ?? []).find((x) => x.week === m.week);
    const tid = w?.tournamentIds[0];
    if (!w || tid == null) return null;
    const byPlayer = ptsByTournamentPlayer.get(tid);
    if (!byPlayer || byPlayer.size === 0) return null;
    const now = Date.now();
    const startMs = Date.parse(`${w.event.startDate}T00:00:00Z`);
    const endMs = Date.parse(`${w.event.endDate}T23:59:59Z`);
    if (!Number.isFinite(startMs) || now < startMs) return null;
    const ended = Number.isFinite(endMs) && now > endMs;
    const frac = ended || !Number.isFinite(endMs) || endMs <= startMs
      ? 1
      : Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs)));
    const sumFor = (teamId: number) =>
      Math.round(
        (startersByTeam.get(teamId) ?? []).reduce((acc, pid) => acc + (byPlayer.get(pid) ?? 0), 0) * 10,
      ) / 10;
    const s1 = sumFor(m.team1_id);
    const s2 = sumFor(m.team2_id);
    // Ended: win % from the real result. Live: from each team's pace.
    const paceDivisor = Math.max(frac, 0.1);
    const win1 = ended
      ? winProbability(s1, s2, 1)
      : winProbability(s1 / paceDivisor, s2 / paceDivisor, frac);
    return { s1, s2, ended, win1 };
  };
  for (const s of starters ?? []) {
    const pid = (s as any).player_id as number;
    const teamId = (s as any).team_id as number;
    if (!projectedByTeam.has(teamId)) projectedByTeam.set(teamId, 0);
    if (registeredSet != null && !registeredSet.has(pid)) continue; // OUT → 0
    const t = totalByPlayer.get(pid);
    if (!t || t.count === 0) continue;
    const perEvent = applyProjectionVariance(t.sum / t.count, pid, 3);
    projectedByTeam.set(teamId, (projectedByTeam.get(teamId) ?? 0) + perEvent);
  }

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
              const live = m.is_final ? null : liveScoreFor(m);
              const score1 = m.is_final ? m.team1_score : live ? live.s1 : m.team1_score;
              const score2 = m.is_final ? m.team2_score : live ? live.s2 : m.team2_score;
              const proj1 = projectedByTeam.get(m.team1_id) ?? 0;
              const proj2 = projectedByTeam.get(m.team2_id) ?? 0;
              // Projection line only before the week's event has scores;
              // once live/ended, the win % comes from the actual points.
              const hasProj = !m.is_final && !live && (proj1 > 0 || proj2 > 0);
              const win1 = live ? live.win1 : winProbability(proj1, proj2);
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
                      {hasProj && (
                        <p className="text-gray-400 text-xs">
                          {proj1.toFixed(1)} ·{" "}
                          <span className={win1 >= win2 ? "text-white font-semibold" : ""}>{win1}%</span>
                        </p>
                      )}
                      {live && !live.ended && (
                        <p className="text-gray-400 text-xs">
                          <span className={win1 >= win2 ? "text-white font-semibold" : ""}>{win1}%</span> to win
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="text-gray-400 text-xs font-medium">
                    {m.is_final ? "FINAL" : live?.ended ? "UNOFFICIAL" : live ? "LIVE" : "vs"}
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
                      {hasProj && (
                        <p className="text-gray-400 text-xs">
                          {proj2.toFixed(1)} ·{" "}
                          <span className={win2 > win1 ? "text-white font-semibold" : ""}>{win2}%</span>
                        </p>
                      )}
                      {live && !live.ended && (
                        <p className="text-gray-400 text-xs">
                          <span className={win2 > win1 ? "text-white font-semibold" : ""}>{win2}%</span> to win
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
