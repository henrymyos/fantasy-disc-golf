import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { LeagueMember, Matchup } from "@/types";
import {
  DGPT_2026_SCHEDULE,
  effectiveSelection,
  formatEventDateRange,
  formatEventLocation,
} from "@/lib/dgpt-2026-schedule";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { applyProjectionVariance } from "@/lib/projections";
import { getActiveTournament } from "@/lib/lineup-lock";
import { LeagueChat } from "@/components/league-chat";
import { getActivityFeed } from "@/lib/activity-feed";

// Standard-normal CDF via Abramowitz & Stegun 7.1.26 approximation.
function normalCdfOnDashboard(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export default async function LeagueDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, starters_count, selected_event_slugs, waivers_locked, scoring_mode")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const activeTournament = await getActiveTournament(supabase);
  const waiversActive = (league as any).waivers_locked === true || activeTournament !== null;

  const selectedSlugs = new Set(effectiveSelection((league as any).selected_event_slugs));
  const today = new Date().toISOString().slice(0, 10);
  const upcomingEvents = DGPT_2026_SCHEDULE
    .filter((e) => selectedSlugs.has(e.slug) && e.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6);

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", id)
    .single();
  const showMockDraft = draft?.status !== "complete";

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, user_id, is_commissioner, waiver_priority, profiles(username)")
    .eq("league_id", id)
    .order("joined_at");

  const { data: matchups } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_id, team2_id, team1_score, team2_score, is_final,
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

  const scoringMode = (((league as any).scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const winsMap: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m) => { winsMap[m.id] = { wins: 0, losses: 0, points: 0 }; });

  // Total points always come from finalized matchups (or the alt total below).
  (allMatchups ?? []).forEach((m) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    winsMap[m.team1_id].points += m.team1_score;
    winsMap[m.team2_id].points += m.team2_score;
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) {
        winsMap[m.team1_id].wins++;
        winsMap[m.team2_id].losses++;
      } else if (m.team2_score > m.team1_score) {
        winsMap[m.team2_id].wins++;
        winsMap[m.team1_id].losses++;
      }
    }
  });

  // For non-H2H modes, derive W/L (and supplement points) from the per-week
  // team totals computed on the fly from rosters + tournament_results.
  if (scoringMode !== "head_to_head") {
    const weeklyTotals = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weeklyTotals, scoringMode);
    for (const [teamId, rec] of alt) {
      if (!winsMap[teamId]) winsMap[teamId] = { wins: 0, losses: 0, points: 0 };
      winsMap[teamId].wins = rec.wins;
      winsMap[teamId].losses = rec.losses;
      // If matchups haven't accumulated points (e.g. no H2H run), fall back
      // to summed weekly totals so the points column isn't all zeros.
      if (winsMap[teamId].points === 0) {
        let sum = 0;
        for (const v of (weeklyTotals.get(teamId)?.values() ?? [])) sum += v;
        winsMap[teamId].points = sum;
      }
    }
  }

  const standings = (members ?? [])
    .map((m) => ({ ...m, ...winsMap[m.id] }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  const myMembership = (members ?? []).find((m) => m.user_id === user.id);

  const activity = await getActivityFeed(supabase, Number(id), 15);

  // Compute each team's projected total + pace-adjusted finishing estimate
  // for the active/upcoming event so we can surface them on each matchup row
  // along with a win-percentage gauge.
  let projectedByTeam = new Map<number, number>();
  let finishingByTeam = new Map<number, number>();
  let inProgress = false;
  let progressFrac = 0;
  if ((matchups ?? []).length > 0) {
    const { data: nextTournament } = activeTournament
      ? { data: activeTournament }
      : await supabase
          .from("tournaments")
          .select("id, start_date, end_date, lock_at")
          .gte("start_date", today)
          .order("start_date", { ascending: true })
          .limit(1)
          .maybeSingle();
    const nextTournamentId = (nextTournament as any)?.id ?? null;

    inProgress = activeTournament !== null;
    if (inProgress && activeTournament) {
      const startMs = activeTournament.lock_at
        ? Date.parse(activeTournament.lock_at)
        : Date.parse(`${activeTournament.start_date}T00:00:00Z`);
      const endMs = Date.parse(`${activeTournament.end_date}T23:59:59Z`);
      const span = endMs - startMs;
      if (Number.isFinite(span) && span > 0) {
        progressFrac = Math.min(1, Math.max(0, (Date.now() - startMs) / span));
      }
    }
    const paceDivisor = Math.max(progressFrac, 0.1);

    const { data: starters } = await supabase
      .from("rosters")
      .select("team_id, player_id")
      .eq("league_id", id)
      .eq("is_starter", true);
    const { data: allResults } = await supabase
      .from("tournament_results")
      .select("player_id, tournament_id, fantasy_points");
    const totalByPlayer = new Map<number, { sum: number; count: number }>();
    const weekActualByPlayer = new Map<number, number>();
    (allResults ?? []).forEach((r: any) => {
      const cur = totalByPlayer.get(r.player_id) ?? { sum: 0, count: 0 };
      cur.sum += Number(r.fantasy_points ?? 0);
      cur.count += 1;
      totalByPlayer.set(r.player_id, cur);
      if (nextTournamentId != null && r.tournament_id === nextTournamentId) {
        weekActualByPlayer.set(r.player_id, (weekActualByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
      }
    });
    for (const s of starters ?? []) {
      const pid = (s as any).player_id;
      const tid = (s as any).team_id;
      const actual = weekActualByPlayer.get(pid);
      const t = totalByPlayer.get(pid);
      const seasonProj = t && t.count > 0
        ? applyProjectionVariance(t.sum / t.count, pid, 3)
        : 0;

      // For the matchup row display: actual when in-progress, else projection.
      const displayPts = actual != null ? actual : seasonProj;
      projectedByTeam.set(tid, (projectedByTeam.get(tid) ?? 0) + displayPts);

      // For win %: pace extrapolation if the player has already scored,
      // otherwise the pre-event projection.
      const finishingPts = inProgress && actual != null
        ? actual / paceDivisor
        : seasonProj;
      finishingByTeam.set(tid, (finishingByTeam.get(tid) ?? 0) + finishingPts);
    }
  }

  // Residual variance shrinks as the active tournament progresses.
  const baseSigma = 28;
  const sigma = baseSigma * Math.sqrt(Math.max(0.05, 1 - progressFrac));
  const matchupSpread = Math.sqrt(2 * sigma * sigma);
  function winPctFor(t1Id: number, t2Id: number): number {
    const t1 = finishingByTeam.get(t1Id) ?? 0;
    const t2 = finishingByTeam.get(t2Id) ?? 0;
    if (t1 === 0 && t2 === 0) return 50;
    return Math.round(normalCdfOnDashboard((t1 - t2) / matchupSpread) * 100);
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Standings */}
      <div className="lg:col-span-1 bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-4">Standings</h2>
        <div className="space-y-2">
          {standings.map((t, i) => {
            const isMe = t.user_id === user.id;
            const href = isMe ? `/league/${id}/lineups` : `/league/${id}/team/${t.id}`;
            return (
              <Link
                key={t.id}
                href={href}
                className={`flex items-center justify-between py-2 px-3 rounded-lg transition ${
                  isMe
                    ? "bg-[#4B3DFF]/15 border border-[#4B3DFF]/30 hover:bg-[#4B3DFF]/20"
                    : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-gray-400 text-sm w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-white text-sm font-medium truncate">{t.team_name}</p>
                      {waiversActive && (t as any).waiver_priority != null && (
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
                <div className="text-right">
                  <p className="text-white text-sm font-semibold">{t.wins}-{t.losses}</p>
                  <p className="text-gray-400 text-xs">{t.points.toFixed(0)} pts</p>
                </div>
              </Link>
            );
          })}
          {standings.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">No teams yet</p>
          )}
        </div>
      </div>

      {/* This week's matchups */}
      <div className="lg:col-span-2 space-y-4">
        {showMockDraft && (
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
        )}

        {myMembership && (
          <div>
            <h2 className="font-bold text-white mb-2 px-1 text-sm uppercase tracking-wider">Chat</h2>
            <LeagueChat
              leagueId={Number(id)}
              myMemberId={myMembership.id}
              members={(members ?? []).map((m: any) => ({
                id: m.id,
                team_name: m.team_name,
                user_id: m.user_id ?? null,
              }))}
            />
          </div>
        )}

        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h2 className="font-bold text-white mb-4">Week {league.current_week} Matchups</h2>
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
                    team1Projected={projectedByTeam.get(m.team1_id) ?? null}
                    team2Projected={projectedByTeam.get(m.team2_id) ?? null}
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

        {/* Upcoming tournaments */}
        {upcomingEvents.length > 0 && (
          <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
            <h2 className="font-bold text-white mb-4">Upcoming Tournaments</h2>
            <div className="space-y-2">
              {upcomingEvents.map((event) => {
                const url = event.pdgaEventId
                  ? `https://www.pdga.com/tour/event/${event.pdgaEventId}`
                  : `https://www.pdga.com/tour/search?keys=${encodeURIComponent(event.name)}`;
                return (
                  <a
                    key={event.slug}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-4 p-3 rounded-xl bg-[#0f1117] border border-white/5 hover:border-white/15 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm truncate">{event.name}</p>
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
  );
}

function MatchupRow({
  leagueId,
  matchup,
  myTeamId,
  team1Projected,
  team2Projected,
  team1WinPct,
  team2WinPct,
}: {
  leagueId: string;
  matchup: Matchup;
  myTeamId?: number;
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
          score={matchup.team1_score}
          projected={team1Projected}
          isFinal={matchup.is_final}
          isWinner={matchup.is_final && matchup.team1_score > matchup.team2_score}
        />
        <div className="text-center">
          <span className="text-gray-400 text-xs font-medium">{matchup.is_final ? "FINAL" : "vs"}</span>
        </div>
        <TeamScore
          name={(matchup.team2 as any)?.team_name ?? "TBD"}
          score={matchup.team2_score}
          projected={team2Projected}
          isFinal={matchup.is_final}
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
          <p className="text-gray-400 text-[10px] mt-0.5">~{projected.toFixed(1)} proj</p>
        )}
      </div>
    </div>
  );
}
