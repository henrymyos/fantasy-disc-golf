import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { LeagueMember, Matchup } from "@/types";
import {
  effectiveSelection,
  formatEventDateRange,
  formatEventLocation,
  playoffCountForTeams,
} from "@/lib/dgpt-2026-schedule";
import { playoffBracketSize } from "@/lib/playoffs";
import { getLineupIssues } from "@/lib/lineup-alert";
import { optimizeLineup } from "@/actions/rosters";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { isSeasonOver } from "@/lib/season-status";
import { getPlayoffOutcome } from "@/lib/playoff-outcome";
import { SeasonReview } from "@/components/season-review";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { rankTeams } from "@/lib/standings";
import { buildWeekProjections } from "@/lib/matchup-projections";
import { getActiveTournament } from "@/lib/lineup-lock";
import { featuredWeekFor, getLeagueSchedule } from "@/lib/league-schedule";
import { CopyButton } from "@/components/copy-button";
import { InviteLink } from "@/components/invite-link";
import { getActivityFeed } from "@/lib/activity-feed";
import { fetchDiscGolfNews } from "@/lib/news-feed";
import { computeSetupSteps, setupProgress } from "@/lib/league-setup";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { stripeEnabled } from "@/lib/stripe";
import { createDuesCheckout } from "@/actions/dues";

export default async function LeagueDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, starters_count, mpo_starters, fpo_starters, selected_event_slugs, waivers_locked, scoring_mode, scoring_rules, invite_code, max_teams, commissioner_id, season_year, dues_amount")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const isCommissioner = (league as any).commissioner_id === user.id;

  const activeTournament = await getActiveTournament(supabase, Number(id));
  const waiversActive = (league as any).waivers_locked === true || activeTournament !== null;

  const scheduleEvents = await getScheduleEvents(supabase, (league as any).season_year ?? DEFAULT_SEASON_YEAR);
  const selectedSlugs = new Set(effectiveSelection((league as any).selected_event_slugs, scheduleEvents));
  const today = new Date().toISOString().slice(0, 10);
  // The "Upcoming Tournaments" widget is an informational view of the DGPT
  // tour, not the league's scoring schedule — so it shows every event that is
  // currently running (started but not yet ended) or still ahead, regardless
  // of which events this league selected to count.
  const upcomingEvents = scheduleEvents
    .filter((e) => e.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6);

  const { data: draft } = await supabase
    .from("drafts")
    .select("status, scheduled_at")
    .eq("league_id", id)
    .single();
  const showMockDraft = draft?.status !== "complete";
  // Once a draft has a scheduled time (but hasn't finished), let everyone peek at
  // the draft board alongside the mock-draft option.
  const draftScheduled = draft?.status === "pending" && !!(draft as any)?.scheduled_at;

  // Setup checklist: any-matchup existence is needed; member count comes from
  // the members query below, so steps are assembled after that.
  const { count: anyMatchupCount } = isCommissioner
    ? await supabase.from("matchups").select("id", { count: "exact", head: true }).eq("league_id", id)
    : { count: 0 };

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, user_id, is_commissioner, waiver_priority, dues_paid, profiles(username, avatar_url, avatar_color)")
    .eq("league_id", id)
    .order("joined_at");

  // Before the draft starts and while there's still an open slot, surface the
  // invite code so the league can be filled.
  const preDraft = draft?.status == null || draft.status === "pending";
  const inviteCode = (league as any).invite_code as string | null;
  const maxTeams = (league as any).max_teams as number | null;
  const leagueIsFull = maxTeams != null && (members ?? []).length >= maxTeams;
  const showInviteCode = preDraft && !!inviteCode && !leagueIsFull;
  // Open-slot placeholders only make sense while joining is still possible.
  const emptySlotCount =
    preDraft && maxTeams != null ? Math.max(0, maxTeams - (members ?? []).length) : 0;

  // The featured week: the just-finished week keeps top billing until
  // Wednesday midday, then the dashboard flips to the new current week.
  const leagueSchedule = await getLeagueSchedule(supabase, Number(id));
  const featuredWeek = leagueSchedule
    ? featuredWeekFor(leagueSchedule, league.current_week)
    : league.current_week;

  const { data: matchups } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_id, team2_id, team1_score, team2_score, is_final,
      team1:league_members!matchups_team1_id_fkey(id, team_name),
      team2:league_members!matchups_team2_id_fkey(id, team_name)
    `)
    .eq("league_id", id)
    .eq("week", featuredWeek);

  // Compute standings from all matchups
  const { data: allMatchups } = await supabase
    .from("matchups")
    .select("week, team1_id, team2_id, team1_score, team2_score, is_final")
    .eq("league_id", id)
    .eq("is_final", true);

  const scoringMode = (((league as any).scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const winsMap: Record<number, { wins: number; losses: number; ties: number; points: number }> = {};
  (members ?? []).forEach((m) => { winsMap[m.id] = { wins: 0, losses: 0, ties: 0, points: 0 }; });

  // Points-against + week-by-week results (for the streak chip), H2H only.
  const pointsAgainst = new Map<number, number>();
  const resultsByTeam = new Map<number, Array<{ week: number; r: "W" | "L" | "T" }>>();
  const pushResult = (teamId: number, week: number, r: "W" | "L" | "T") => {
    if (!resultsByTeam.has(teamId)) resultsByTeam.set(teamId, []);
    resultsByTeam.get(teamId)!.push({ week, r });
  };

  // Total points always come from finalized matchups (or the alt total below).
  (allMatchups ?? []).forEach((m) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, ties: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, ties: 0, points: 0 };
    winsMap[m.team1_id].points += m.team1_score;
    winsMap[m.team2_id].points += m.team2_score;
    pointsAgainst.set(m.team1_id, (pointsAgainst.get(m.team1_id) ?? 0) + m.team2_score);
    pointsAgainst.set(m.team2_id, (pointsAgainst.get(m.team2_id) ?? 0) + m.team1_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) {
        winsMap[m.team1_id].wins++;
        winsMap[m.team2_id].losses++;
        pushResult(m.team1_id, (m as any).week, "W");
        pushResult(m.team2_id, (m as any).week, "L");
      } else if (m.team2_score > m.team1_score) {
        winsMap[m.team2_id].wins++;
        winsMap[m.team1_id].losses++;
        pushResult(m.team2_id, (m as any).week, "W");
        pushResult(m.team1_id, (m as any).week, "L");
      } else {
        winsMap[m.team1_id].ties++;
        winsMap[m.team2_id].ties++;
        pushResult(m.team1_id, (m as any).week, "T");
        pushResult(m.team2_id, (m as any).week, "T");
      }
    }
  });

  // "W2" / "L3" — consecutive same results counting back from the latest week.
  const streakFor = (teamId: number): string | null => {
    const rs = (resultsByTeam.get(teamId) ?? []).sort((a, b) => b.week - a.week);
    if (rs.length === 0) return null;
    let n = 1;
    while (n < rs.length && rs[n].r === rs[0].r) n++;
    return `${rs[0].r}${n}`;
  };

  // For non-H2H modes, derive W/L (and supplement points) from the per-week
  // team totals computed on the fly from rosters + tournament_results.
  if (scoringMode !== "head_to_head") {
    const weeklyTotals = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weeklyTotals, scoringMode);
    for (const [teamId, rec] of alt) {
      if (!winsMap[teamId]) winsMap[teamId] = { wins: 0, losses: 0, ties: 0, points: 0 };
      winsMap[teamId].wins = rec.wins;
      winsMap[teamId].losses = rec.losses;
      winsMap[teamId].ties = rec.ties;
      // If matchups haven't accumulated points (e.g. no H2H run), fall back
      // to summed weekly totals so the points column isn't all zeros.
      if (winsMap[teamId].points === 0) {
        let sum = 0;
        for (const v of (weeklyTotals.get(teamId)?.values() ?? [])) sum += v;
        winsMap[teamId].points = sum;
      }
    }
  }

  const ranked = rankTeams(winsMap, (allMatchups ?? []) as any, {
    headToHead: scoringMode === "head_to_head",
  });
  const membersById = new Map((members ?? []).map((m) => [m.id, m]));
  const standings = ranked
    .map((e) => {
      const m = membersById.get(e.teamId);
      return m ? { ...m, wins: e.wins, losses: e.losses, ties: e.ties, points: e.points, strengthOfSchedule: e.strengthOfSchedule } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const myMembership = (members ?? []).find((m) => m.user_id === user.id);

  // How many teams make the playoffs — used to draw the cut line in standings.
  // playoffCountForTeams gives the number of playoff EVENTS (rounds);
  // playoffBracketSize turns that into the seeded team count.
  const playoffTeamCount = playoffBracketSize(
    playoffCountForTeams((league as any).max_teams),
    (members ?? []).length,
  );

  // ── Lineup alert: problems with MY lineup for the CURRENT (actionable) week —
  // empty starter slots, or starters not registered for that week's event.
  const lineupAlert =
    !preDraft && myMembership
      ? await getLineupIssues(supabase, Number(id), myMembership.id)
      : null;
  // The one-tap fix only works while lineups aren't locked.
  const canOptimize = lineupAlert != null && activeTournament === null;

  // My featured-week matchup, for the hero card.
  const myHeroMatchup = myMembership
    ? ((matchups ?? []) as any[]).find(
        (m) => m.team1_id === myMembership.id || m.team2_id === myMembership.id,
      ) ?? null
    : null;

  // Year-end review: once the season is over, the playoff bracket crowns the
  // champion (decided from real weekly scores during the playoff events).
  const seasonOver = isSeasonOver(scheduleEvents, selectedSlugs);
  let seasonReview: Awaited<ReturnType<typeof getPlayoffOutcome>> | null = null;
  if (seasonOver && !preDraft) {
    const outcome = await getPlayoffOutcome(supabase, Number(id));
    if (outcome.champion && outcome.standings.some((s) => s.wins + s.losses > 0)) {
      seasonReview = outcome;
    }
  }

  const setupSteps = isCommissioner
    ? computeSetupSteps(`/league/${id}`, {
        memberCount: (members ?? []).length,
        maxTeams: (league as any).max_teams ?? null,
        scheduleConfigured: (league as any).selected_event_slugs != null,
        matchupsGenerated: (anyMatchupCount ?? 0) > 0,
        scoringConfigured: (league as any).scoring_rules != null,
        draftStatus: draft?.status ?? null,
        draftScheduledAt: (draft as any)?.scheduled_at ?? null,
      })
    : null;
  const setupComplete = setupSteps ? setupProgress(setupSteps).complete : true;

  const duesAmount = Number((league as any).dues_amount ?? 0);
  const myDuesUnpaid = !!myMembership && duesAmount > 0 && !(myMembership as any).dues_paid;
  const canPayOnline = stripeEnabled();

  const activity = await getActivityFeed(supabase, Number(id), 15);
  const news = await fetchDiscGolfNews(6);

  // Most recent finalized recap week — the dashboard only links to the
  // recaps page, which renders the bodies.
  const { data: latestRecap } = await supabase
    .from("weekly_recaps")
    .select("week")
    .eq("league_id", id)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Each team's numbers for the featured week — same helper the matchups list
  // and matchup pages use, so the dashboard cards can't disagree with the
  // matchup they link to.
  const wk = (matchups ?? []).length > 0
    ? await buildWeekProjections(supabase, {
        leagueId: Number(id),
        week: featuredWeek,
        schedule: leagueSchedule,
        league: league as any,
      })
    : null;
  const inProgress = wk?.inProgress ?? false;
  const settled = wk?.settled ?? false;
  const showActuals = (inProgress || settled) && (wk?.hasActuals ?? false);
  const finishingFor = (teamId: number) => wk?.teamNumbers(teamId).finishing ?? null;
  const actualFor = (teamId: number) => wk?.teamNumbers(teamId).actual ?? 0;
  const winPctFor = (t1Id: number, t2Id: number) => wk?.winPctFor(t1Id, t2Id) ?? 50;

  return (
    <div className="space-y-6">
      {draft?.status === "in_progress" && (
        <Link
          href={`/league/${id}/draft?board=1`}
          className="flex items-center justify-between gap-3 rounded-2xl border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 px-5 py-4 transition group"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <div>
              <p className="text-white font-bold leading-tight">Draft is live</p>
              <p className="text-green-300/80 text-xs mt-0.5">Jump into the draft board</p>
            </div>
          </div>
          <span className="text-green-400 font-semibold text-sm group-hover:text-white transition shrink-0">
            Live Draft →
          </span>
        </Link>
      )}

      {lineupAlert && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight">
                {lineupAlert.outNames.length > 0
                  ? `${lineupAlert.outNames.length} starter${lineupAlert.outNames.length !== 1 ? "s" : ""} OUT${lineupAlert.eventName ? ` for ${lineupAlert.eventName}` : ""}`
                  : `${lineupAlert.emptySlots} empty lineup slot${lineupAlert.emptySlots !== 1 ? "s" : ""}`}
              </p>
              <p className="text-red-300/80 text-xs mt-0.5 truncate">
                {lineupAlert.outNames.length > 0 && lineupAlert.outNames.slice(0, 3).join(", ")}
                {lineupAlert.outNames.length > 3 && ` +${lineupAlert.outNames.length - 3} more`}
                {lineupAlert.outNames.length > 0 && lineupAlert.emptySlots > 0 && " · "}
                {lineupAlert.emptySlots > 0 && `${lineupAlert.emptySlots} empty slot${lineupAlert.emptySlots !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canOptimize && (
              <form action={optimizeLineup.bind(null, Number(id))}>
                <button
                  type="submit"
                  className="bg-red-500/90 hover:bg-red-500 text-white text-xs font-bold px-3.5 py-2 rounded-full transition"
                  title="Start your highest-projected eligible players"
                >
                  Optimize
                </button>
              </form>
            )}
            <Link
              href={`/league/${id}/lineups?week=${league.current_week}`}
              className="text-red-400 hover:text-white font-semibold text-sm transition"
            >
              Fix lineup →
            </Link>
          </div>
        </div>
      )}

      {!preDraft && myMembership && (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
          {myHeroMatchup && (() => {
            const m = myHeroMatchup;
            const meLeft = m.team1_id === myMembership.id;
            const t1WinPct = winPctFor(m.team1_id, m.team2_id);
            const scoreFor = (teamId: number, stored: number) =>
              m.is_final || !showActuals
                ? stored
                : actualFor(teamId);
            const side = (teamId: number, stored: number, right?: boolean) => {
              const member = membersById.get(teamId);
              const winPct = teamId === m.team1_id ? t1WinPct : 100 - t1WinPct;
              const winner =
                m.is_final &&
                (teamId === m.team1_id
                  ? m.team1_score > m.team2_score
                  : m.team2_score > m.team1_score);
              return (
                <div className={`min-w-0 flex-1 ${right ? "text-right" : ""}`}>
                  <div className={`flex items-center gap-2.5 ${right ? "flex-row-reverse" : ""}`}>
                    <div className={winner ? "rounded-full ring-2 ring-[#36D7B7]" : ""}>
                      <TeamAvatar
                        name={member?.team_name ?? "TBD"}
                        avatarUrl={(member?.profiles as any)?.avatar_url}
                        avatarColor={(member?.profiles as any)?.avatar_color}
                        seed={teamId}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-bold text-sm truncate">
                        {member?.team_name ?? "TBD"}
                        {teamId === myMembership.id && (
                          <span className="text-gray-400 text-xs font-normal ml-1.5">(you)</span>
                        )}
                      </p>
                      <p className="text-gray-400 text-[11px]">
                        Win {winPct}%
                      </p>
                    </div>
                  </div>
                  <p className="text-white text-2xl font-black tabular-nums mt-2">
                    {scoreFor(teamId, stored).toFixed(1)}
                  </p>
                </div>
              );
            };
            return (
              <Link
                href={`/league/${id}/matchups/${m.id}`}
                className="block px-5 pt-4 pb-4 hover:bg-white/[0.02] transition"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">
                    Your Matchup · Week {featuredWeek}
                  </p>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      m.is_final
                        ? "text-gray-300 bg-white/10"
                        : inProgress
                          ? "text-[#36D7B7] bg-[#36D7B7]/15"
                          : settled
                            ? "text-yellow-300 bg-yellow-400/15"
                            : "text-gray-400 bg-white/5"
                    }`}
                  >
                    {m.is_final ? "Final" : inProgress ? "● Live" : settled ? "Unofficial" : "Upcoming"}
                  </span>
                </div>
                <div className="flex items-end justify-between gap-4">
                  {side(meLeft ? m.team1_id : m.team2_id, meLeft ? m.team1_score : m.team2_score)}
                  <span className="text-gray-500 text-xs font-bold uppercase pb-2 shrink-0">vs</span>
                  {side(meLeft ? m.team2_id : m.team1_id, meLeft ? m.team2_score : m.team1_score, true)}
                </div>
                {!m.is_final && (
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden flex mt-3">
                    <div
                      className="h-full bg-[#4B3DFF]"
                      style={{ width: `${meLeft ? t1WinPct : 100 - t1WinPct}%` }}
                    />
                    <div
                      className="h-full bg-[#36D7B7]"
                      style={{ width: `${meLeft ? 100 - t1WinPct : t1WinPct}%` }}
                    />
                  </div>
                )}
              </Link>
            );
          })()}
          {(() => {
            const rec = winsMap[myMembership.id];
            const rank = standings.findIndex((t) => t.id === myMembership.id) + 1;
            const pa = pointsAgainst.get(myMembership.id) ?? 0;
            const waiver = (myMembership as any).waiver_priority as number | null;
            const chip = (label: string, value: string) => (
              <div className="min-w-0">
                <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">{label}</p>
                <p className="text-white text-sm font-bold tabular-nums mt-0.5 truncate">{value}</p>
              </div>
            );
            return (
              <div className="grid grid-cols-4 gap-3 px-5 py-3 border-t border-white/5 bg-[#0f1117]/60">
                {chip("Record", rec ? `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ""}` : "—")}
                {chip("Rank", rank > 0 ? `#${rank} of ${standings.length}` : "—")}
                {chip("Pts For / Ag", rec ? `${rec.points.toFixed(0)} / ${pa.toFixed(0)}` : "—")}
                {chip("Waiver", waiver != null ? `#${waiver}` : "—")}
              </div>
            );
          })()}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
      {/* Standings (or team roster before the draft) */}
      <div className="lg:col-span-1 min-w-0 bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-4">{preDraft ? "Teams" : "Standings"}</h2>
        <div className="space-y-2">
          {preDraft ? (
            <>
              {(members ?? []).map((t, i) => {
                const isMe = t.user_id === user.id;
                const href = isMe ? `/league/${id}/lineups` : `/league/${id}/team/${t.id}`;
                return (
                  <Link
                    key={t.id}
                    href={href}
                    className={`flex items-center gap-3 py-2 px-3 rounded-lg transition min-w-0 ${
                      isMe
                        ? "bg-[#4B3DFF]/15 border border-[#4B3DFF]/30 hover:bg-[#4B3DFF]/20"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <span className="text-gray-400 text-sm w-4">{i + 1}</span>
                    <TeamAvatar
                      name={t.team_name}
                      avatarUrl={(t.profiles as any)?.avatar_url}
                      avatarColor={(t.profiles as any)?.avatar_color}
                      seed={t.id}
                    />
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{t.team_name}</p>
                      <p className="text-gray-400 text-xs truncate">{(t.profiles as any)?.username}</p>
                    </div>
                  </Link>
                );
              })}
              {Array.from({ length: emptySlotCount }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg border border-dashed border-white/10"
                >
                  <span className="text-gray-600 text-sm w-4">{(members ?? []).length + i + 1}</span>
                  <p className="text-gray-500 text-sm italic">Open slot</p>
                </div>
              ))}
              {(members ?? []).length === 0 && emptySlotCount === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No teams yet</p>
              )}
            </>
          ) : (
            <>
              {standings.map((t, i) => {
                const isMe = t.user_id === user.id;
                const href = isMe ? `/league/${id}/lineups` : `/league/${id}/team/${t.id}`;
                const streak = scoringMode === "head_to_head" ? streakFor(t.id) : null;
                const pa = pointsAgainst.get(t.id) ?? 0;
                const showCutLine =
                  playoffTeamCount > 0 &&
                  standings.length > playoffTeamCount &&
                  i + 1 === playoffTeamCount;
                return (
                  <div key={t.id}>
                    <Link
                      href={href}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg transition ${
                        isMe
                          ? "bg-[#4B3DFF]/15 border border-[#4B3DFF]/30 hover:bg-[#4B3DFF]/20"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-gray-400 text-sm w-4">{i + 1}</span>
                        <TeamAvatar
                          name={t.team_name}
                          avatarUrl={(t.profiles as any)?.avatar_url}
                          avatarColor={(t.profiles as any)?.avatar_color}
                          seed={t.id}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-white text-sm font-medium truncate">{t.team_name}</p>
                            {draft?.status === "complete" && waiversActive && (t as any).waiver_priority != null && (
                              <span
                                className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-yellow-300 bg-yellow-400/15"
                                title={`Next waiver pick: #${(t as any).waiver_priority}`}
                              >
                                W#{(t as any).waiver_priority}
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-xs">{(t.profiles as any)?.username}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white text-sm font-semibold">
                          {t.wins}-{t.losses}
                          {streak && (
                            <span
                              className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded align-middle ${
                                streak.startsWith("W")
                                  ? "text-[#36D7B7] bg-[#36D7B7]/15"
                                  : streak.startsWith("L")
                                    ? "text-red-400 bg-red-500/15"
                                    : "text-gray-300 bg-white/10"
                              }`}
                              title={`${streak.startsWith("W") ? "Won" : streak.startsWith("L") ? "Lost" : "Tied"} last ${streak.slice(1)}`}
                            >
                              {streak}
                            </span>
                          )}
                        </p>
                        <p
                          className="text-gray-400 text-xs tabular-nums"
                          title={`${t.points.toFixed(1)} points for · ${pa.toFixed(1)} points against${
                            (t as any).strengthOfSchedule >= 0
                              ? ` · SoS ${Math.round((t as any).strengthOfSchedule * 100)}%`
                              : ""
                          }`}
                        >
                          {t.points.toFixed(0)} PF · {pa.toFixed(0)} PA
                        </p>
                      </div>
                    </Link>
                    {showCutLine && (
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1" title={`Top ${playoffTeamCount} make the playoffs`}>
                        <div className="flex-1 border-t border-dashed border-[#F5A623]/40" />
                        <span className="text-[#F5A623]/80 text-[10px] font-bold uppercase tracking-wider">
                          Playoff line
                        </span>
                        <div className="flex-1 border-t border-dashed border-[#F5A623]/40" />
                      </div>
                    )}
                  </div>
                );
              })}
              {standings.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No teams yet</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* This week's matchups */}
      <div className="lg:col-span-2 min-w-0 space-y-4">
        {seasonReview && seasonReview.champion && (
          <SeasonReview
            seasonYear={(league as any).season_year ?? DEFAULT_SEASON_YEAR}
            champion={seasonReview.champion}
            consolationChamp={seasonReview.consolationChamp}
            lastPlace={seasonReview.lastPlace}
          />
        )}

        {setupSteps && !setupComplete && (
          <OnboardingChecklist steps={setupSteps} />
        )}

        {myDuesUnpaid && (
          <div className="bg-[#1a1d23] rounded-2xl px-4 py-3.5 border border-yellow-400/25 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold">League dues: ${duesAmount.toFixed(0)} due</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {canPayOnline ? "Pay securely with a card." : "Settle up with your commissioner."}
              </p>
            </div>
            {canPayOnline && (
              <form
                action={async () => {
                  "use server";
                  await createDuesCheckout(Number(id));
                }}
              >
                <button
                  type="submit"
                  className="bg-[#4B3DFF] hover:bg-[#3a2eff] text-white text-sm font-semibold px-4 py-2 rounded-lg transition shrink-0"
                >
                  Pay ${duesAmount.toFixed(0)}
                </button>
              </form>
            )}
          </div>
        )}

        {showInviteCode && (
          <div className="bg-[#1a1d23] rounded-xl px-4 py-3 border border-[#4B3DFF]/30 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-xs shrink-0">Invite code</span>
              <span className="flex-1 min-w-0 font-mono text-white font-bold tracking-widest select-all truncate">
                {inviteCode}
              </span>
              <CopyButton value={inviteCode!} label="Copy invite code" className="h-8 w-8" />
            </div>
            <InviteLink code={inviteCode!} leagueName={league.name} />
          </div>
        )}

        {showMockDraft && draftScheduled ? (
          // Draft is scheduled: split control — view the draft board (left) and
          // run a mock draft (right).
          <div className="grid grid-cols-2 gap-3">
            <Link
              href={`/league/${id}/draft`}
              className="block bg-[#1a1d23] rounded-2xl p-5 border border-white/5 hover:border-[#36D7B7]/40 hover:bg-[#1a1d23]/80 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#36D7B7]/20 border border-[#36D7B7]/30 flex items-center justify-center text-xl shrink-0">
                  📋
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">View Draft Board</p>
                  <p className="text-gray-400 text-xs mt-0.5 truncate">
                    Draft order &amp; board
                  </p>
                </div>
              </div>
            </Link>
            <Link
              href={`/league/${id}/mock-draft`}
              className="block bg-[#1a1d23] rounded-2xl p-5 border border-white/5 hover:border-[#4B3DFF]/40 hover:bg-[#1a1d23]/80 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-xl shrink-0">
                  🎯
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">Mock Draft</p>
                  <p className="text-gray-400 text-xs mt-0.5 truncate">
                    Practice against bots
                  </p>
                </div>
              </div>
            </Link>
          </div>
        ) : showMockDraft ? (
          <Link
            href={`/league/${id}/mock-draft`}
            className="block bg-[#1a1d23] rounded-2xl p-5 border border-white/5 hover:border-[#4B3DFF]/40 hover:bg-[#1a1d23]/80 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-xl shrink-0">
                  🎯
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">Mock Draft</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    Practice against bots — pick your draft position and go
                  </p>
                </div>
              </div>
              <span className="text-gray-400 text-lg shrink-0">→</span>
            </div>
          </Link>
        ) : null}

        {latestRecap && (
          <Link href={`/league/${id}/recaps`} className="block">
            <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 hover:border-white/15 transition flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-xl shrink-0">
                  📰
                </div>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">Week {(latestRecap as any).week} Recap</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    Matchup results &amp; weekly awards
                  </p>
                </div>
              </div>
              <span className="text-gray-400 text-lg shrink-0">→</span>
            </div>
          </Link>
        )}

        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h2 className="font-bold text-white mb-4">Week {featuredWeek} Matchups</h2>
          {(matchups ?? []).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              No matchups scheduled yet
            </p>
          ) : (
            <div className="space-y-3">
              {(matchups as unknown as Matchup[]).map((m) => {
                const t1WinPct = winPctFor(m.team1_id, m.team2_id);
                return (
                  <MatchupRow
                    key={m.id}
                    leagueId={id}
                    matchup={m}
                    myTeamId={myMembership?.id}
                    team1Score={
                      m.is_final || !showActuals
                        ? m.team1_score
                        : actualFor(m.team1_id)
                    }
                    team2Score={
                      m.is_final || !showActuals
                        ? m.team2_score
                        : actualFor(m.team2_id)
                    }
                    settled={settled}
                    team1Projected={finishingFor(m.team1_id)}
                    team2Projected={finishingFor(m.team2_id)}
                    team1WinPct={t1WinPct}
                    team2WinPct={100 - t1WinPct}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Activity feed */}
        {activity.length > 0 && (
          <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
            <h2 className="font-bold text-white mb-4">Recent Activity</h2>
            <ul className="space-y-2">
              {activity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 text-sm">
                  <span
                    className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={(() => {
                      switch (item.kind) {
                        case "add":
                          return { background: "rgba(54,215,183,0.15)", color: "#36D7B7" };
                        case "drop":
                          return { background: "rgba(248,113,113,0.15)", color: "#f87171" };
                        case "trade":
                          return { background: "rgba(75,61,255,0.18)", color: "#a09aff" };
                        default:
                          return { background: "rgba(245,165,36,0.15)", color: "#F5A524" };
                      }
                    })()}
                  >
                    {item.kind === "add" ? "+" : item.kind === "drop" ? "−" : item.kind === "trade" ? "⇄" : "!"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm leading-snug">{item.description}</p>
                    <p className="text-gray-400 text-[10px] mt-0.5">
                      {new Date(item.ts).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* News feed */}
        {news.length > 0 && (
          <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white">Disc Golf News</h2>
              <a
                href="https://ultiworld.com/category/disc-golf-news/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white text-xs"
              >
                Ultiworld →
              </a>
            </div>
            <ul className="space-y-2">
              {news.map((n) => (
                <li key={n.link}>
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-xl bg-[#0f1117] border border-white/5 hover:border-white/15 transition"
                  >
                    <p className="text-white text-sm font-medium leading-snug">{n.title}</p>
                    {n.pubDate && (
                      <p className="text-gray-400 text-[11px] mt-1">
                        {new Date(n.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Upcoming tournaments */}
        {upcomingEvents.length > 0 && (
          <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
            <h2 className="font-bold text-white mb-4">Upcoming Tournaments</h2>
            <div className="space-y-2">
              {upcomingEvents.map((event) => {
                const url = event.pdgaEventId
                  ? `https://www.pdga.com/tour/event/${event.pdgaEventId}`
                  : `https://www.pdga.com/tour/search?keys=${encodeURIComponent(event.name)}`;
                const isLive = event.startDate <= today && event.endDate >= today;
                return (
                  <a
                    key={event.slug}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-4 p-3 rounded-xl bg-[#0f1117] border border-white/5 hover:border-white/15 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {isLive && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[#36D7B7] bg-[#36D7B7]/15">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#36D7B7] animate-pulse" />
                            Live
                          </span>
                        )}
                        <p className="text-white font-medium text-sm truncate">{event.name}</p>
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5 truncate">
                        {formatEventDateRange(event)} · {formatEventLocation(event)}
                      </p>
                    </div>
                    <span className="text-gray-400 text-sm shrink-0">→</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

      </div>
      </div>
    </div>
  );
}

function MatchupRow({
  leagueId,
  matchup,
  myTeamId,
  team1Score,
  team2Score,
  settled,
  team1Projected,
  team2Projected,
  team1WinPct,
  team2WinPct,
}: {
  leagueId: string;
  matchup: Matchup;
  myTeamId?: number;
  team1Score: number;
  team2Score: number;
  settled: boolean;
  team1Projected: number | null;
  team2Projected: number | null;
  team1WinPct: number;
  team2WinPct: number;
}) {
  const isMyMatchup = matchup.team1_id === myTeamId || matchup.team2_id === myTeamId;
  return (
    <Link
      href={`/league/${leagueId}/matchups/${matchup.id}`}
      className={`block p-4 rounded-xl border transition hover:bg-white/[0.03] ${
        isMyMatchup ? "border-[#4B3DFF]/40 bg-[#4B3DFF]/5" : "border-white/5 bg-[#0f1117]"
      }`}
    >
      <div className="flex items-center justify-between">
        <TeamScore
          name={(matchup.team1 as any)?.team_name ?? "TBD"}
          score={team1Score}
          projected={team1Projected}
          isFinal={matchup.is_final || settled}
          isWinner={matchup.is_final && matchup.team1_score > matchup.team2_score}
        />
        <div className="text-center">
          <span className="text-gray-400 text-xs font-medium">
            {matchup.is_final ? "FINAL" : settled ? "UNOFFICIAL" : "vs"}
          </span>
        </div>
        <TeamScore
          name={(matchup.team2 as any)?.team_name ?? "TBD"}
          score={team2Score}
          projected={team2Projected}
          isFinal={matchup.is_final || settled}
          isWinner={matchup.is_final && matchup.team2_score > matchup.team1_score}
          right
        />
      </div>

      {!matchup.is_final && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden flex">
            <div className="h-full bg-[#4B3DFF]" style={{ width: `${team1WinPct}%` }} />
            <div className="h-full bg-[#36D7B7]" style={{ width: `${team2WinPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] uppercase tracking-wider mt-1.5">
            <span className="text-[#4B3DFF] font-semibold">{team1WinPct}%</span>
            <span className="text-[#36D7B7] font-semibold">{team2WinPct}%</span>
          </div>
        </div>
      )}
    </Link>
  );
}

function TeamScore({
  name,
  score,
  projected,
  isFinal,
  isWinner,
  right,
}: {
  name: string;
  score: number;
  projected: number | null;
  isFinal: boolean;
  isWinner: boolean;
  right?: boolean;
}) {
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
        {!isFinal && projected != null && projected > 0 && (
          <p className="text-gray-400 text-xs mt-0.5">{projected.toFixed(1)}</p>
        )}
      </div>
    </div>
  );
}

// Team logo shown in the standings/teams list. Uses the owner's profile avatar
// when they have one; otherwise a generic circle with their initial, colored in
// one of the app's two accent colors (blue / green) picked stably per team.
function TeamAvatar({
  name,
  avatarUrl,
  avatarColor,
  seed,
}: {
  name: string;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  seed: number;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 bg-white/10" />
    );
  }
  const color = avatarColor || (seed % 2 === 0 ? "#4B3DFF" : "#36D7B7");
  return (
    <div
      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
      style={{ backgroundColor: color }}
    >
      {name?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}
