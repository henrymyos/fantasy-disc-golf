import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyProjectionVariance, winProbability } from "@/lib/projections";
import { getLeagueSchedule } from "@/lib/league-schedule";
import { fantasyPointsFromResult, resolveScoringRules, describeScoreContributions } from "@/lib/scoring-rules";
import { LiveScoreRefresher } from "@/components/live-score-refresher";
import { WinProbChart } from "@/components/win-prob-chart";
import { LiveEventFeed, type LiveFeedRow } from "@/components/live-event-feed";
import { MatchupWrapup } from "@/components/matchup-wrapup";

type PlayerRow = {
  rosterId: number;
  playerId: number;
  name: string;
  nickname: string | null;
  division: "MPO" | "FPO";
  slotLabel: string;
  actual: number | null;
  projected: number | null;
  paceProjected: number | null;
  isOut: boolean;
  breakdown: string | null;
};

type WeekStat = {
  finishing_position: number | null;
  hot_round_count: number;
  bogey_free_count: number;
  ace_count: number;
  under_par_strokes: number;
  over_par_strokes: number;
  eagle_count: number;
};

function buildSlotArray(starters: any[], numSlots: number): (any | null)[] {
  const result: (any | null)[] = new Array(numSlots).fill(null);
  const unordered: any[] = [];
  for (const s of starters) {
    const o = s.lineup_order;
    if (o != null && o >= 1 && o <= numSlots && result[o - 1] === null) {
      result[o - 1] = s;
    } else {
      unordered.push(s);
    }
  }
  let ui = 0;
  for (let i = 0; i < numSlots && ui < unordered.length; i++) {
    if (result[i] === null) result[i] = unordered[ui++];
  }
  return result;
}

export default async function MatchupDetailPage({
  params,
}: {
  params: Promise<{ id: string; matchupId: string }>;
}) {
  const { id, matchupId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: matchup } = await supabase
    .from("matchups")
    .select(`
      id, week, team1_id, team2_id, team1_score, team2_score, is_final,
      team1:league_members!matchups_team1_id_fkey(id, team_name, division_name),
      team2:league_members!matchups_team2_id_fkey(id, team_name, division_name)
    `)
    .eq("id", matchupId)
    .eq("league_id", id)
    .single();
  if (!matchup) notFound();

  const { data: league } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters, scoring_rules")
    .eq("id", id)
    .single();
  const mpoSlots: number = (league as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (league as any)?.fpo_starters ?? 2;
  const rules = resolveScoringRules((league as any)?.scoring_rules);

  const team1 = matchup.team1 as any;
  const team2 = matchup.team2 as any;

  // This matchup belongs to a specific LEAGUE week → resolve that week's event
  // through the league schedule (matchup.week is the league's own week index;
  // the global tournaments.week column is a per-import counter and maps to the
  // wrong event), so every matchup in a week scores against the same event.
  const schedule = await getLeagueSchedule(supabase, Number(id));
  const scheduleWeek = schedule?.weeks.find((w) => w.week === matchup.week) ?? null;
  const weekIds = scheduleWeek?.tournamentIds ?? [];
  const { data: weekTournaments } = weekIds.length > 0
    ? await supabase
        .from("tournaments")
        .select("id, name, start_date, end_date, lock_at, registered_player_ids")
        .in("id", weekIds)
        .order("start_date", { ascending: true })
    : { data: [] as any[] };
  const weekTournamentIds = new Set((weekTournaments ?? []).map((t: any) => t.id as number));
  const primaryTournament = (weekTournaments ?? [])[0] as any | undefined;
  const weekTournamentName: string | null =
    primaryTournament?.name ?? scheduleWeek?.event.name ?? null;
  const weekDateLabel: string | null = (() => {
    const start = primaryTournament?.start_date ?? scheduleWeek?.event.startDate;
    const end = primaryTournament?.end_date ?? scheduleWeek?.event.endDate;
    if (!start) return null;
    const fmt = (d: string) =>
      new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const s = fmt(start);
    const e = end ? fmt(end) : s;
    return s === e ? s : `${s} – ${e}`;
  })();

  // The week's event is "in progress" when now is between its lock/start and end.
  let inProgress = false;
  let progressFrac = 0;
  if (primaryTournament) {
    const startMs = primaryTournament.lock_at
      ? Date.parse(primaryTournament.lock_at)
      : Date.parse(`${primaryTournament.start_date}T00:00:00Z`);
    const endMs = Date.parse(`${primaryTournament.end_date}T23:59:59Z`);
    const now = Date.now();
    inProgress = now >= startMs && now <= endMs;
    const span = endMs - startMs;
    if (inProgress && span > 0) {
      progressFrac = Math.min(1, Math.max(0, (now - startMs) / span));
    }
  }
  const paceDivisor = Math.max(progressFrac, 0.1);

  // Players not registered for this week's event are OUT (projected 0).
  let registeredSet: Set<number> | null = null;
  const regIds = primaryTournament?.registered_player_ids as number[] | null | undefined;
  if (regIds && regIds.length > 0) registeredSet = new Set(regIds);

  const { data: roster } = await supabase
    .from("rosters")
    .select("id, team_id, player_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", id)
    .in("team_id", [matchup.team1_id, matchup.team2_id])
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  const allRoster = (roster ?? []) as any[];

  // Per-team player nicknames (shown under each name on this matchup).
  const { data: nickRows } = await supabase
    .from("player_nicknames")
    .select("team_id, player_id, nickname")
    .in("team_id", [matchup.team1_id, matchup.team2_id]);
  const nickByTeamPlayer = new Map<string, string>(
    (nickRows ?? []).map((n: any) => [`${n.team_id}:${n.player_id}`, n.nickname as string]),
  );

  const playerIds = allRoster.map((r) => r.player_id);
  const { data: results } = playerIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, finishing_position, hot_round_count, bogey_free_count, ace_count, under_par_strokes, over_par_strokes, eagle_count, players(division)")
        .in("player_id", playerIds)
    : { data: [] };

  const totals = new Map<number, { sum: number; count: number }>();
  const actuals = new Map<number, number>();
  const weekStats = new Map<number, WeekStat>();
  (results ?? []).forEach((r: any) => {
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
    const cur = totals.get(r.player_id) ?? { sum: 0, count: 0 };
    cur.sum += pts;
    cur.count += 1;
    totals.set(r.player_id, cur);
    if (weekTournamentIds.has(r.tournament_id)) {
      actuals.set(r.player_id, (actuals.get(r.player_id) ?? 0) + pts);
      const ws = weekStats.get(r.player_id) ?? {
        finishing_position: null, hot_round_count: 0, bogey_free_count: 0,
        ace_count: 0, under_par_strokes: 0, over_par_strokes: 0, eagle_count: 0,
      };
      ws.finishing_position = r.finishing_position ?? ws.finishing_position;
      ws.hot_round_count += Number(r.hot_round_count ?? 0);
      ws.bogey_free_count += Number(r.bogey_free_count ?? 0);
      ws.ace_count += Number(r.ace_count ?? 0);
      ws.under_par_strokes += Number(r.under_par_strokes ?? 0);
      ws.over_par_strokes += Number(r.over_par_strokes ?? 0);
      ws.eagle_count += Number(r.eagle_count ?? 0);
      weekStats.set(r.player_id, ws);
    }
  });

  function rowFor(s: any, slotLabel: string): PlayerRow {
    const t = totals.get(s.player_id);
    const actual = actuals.has(s.player_id)
      ? Math.round(actuals.get(s.player_id)! * 10) / 10
      : null;
    const seasonProjected = t && t.count > 0
      ? applyProjectionVariance(t.sum / t.count, s.player_id, 3)
      : null;
    const isOut =
      registeredSet != null
      && !registeredSet.has(s.player_id)
      && actual == null;
    const projected = isOut ? 0 : seasonProjected;
    let paceProjected: number | null = null;
    if (inProgress && actual != null) {
      paceProjected = Math.round((actual / paceDivisor) * 10) / 10;
    }
    const ws = weekStats.get(s.player_id);
    const breakdown = actual != null && ws ? describeScoreContributions(rules, ws) : null;
    return {
      rosterId: s.id,
      playerId: s.player_id,
      name: s.players?.name ?? "Unknown",
      nickname: nickByTeamPlayer.get(`${s.team_id}:${s.player_id}`) ?? null,
      division: (s.players?.division as "MPO" | "FPO") ?? "MPO",
      slotLabel,
      actual,
      projected,
      paceProjected,
      isOut,
      breakdown,
    };
  }

  function buildTeam(teamId: number) {
    const teamRoster = allRoster.filter((r) => r.team_id === teamId);
    const mpoStarters = teamRoster.filter(
      (r) => r.is_starter && r.players?.division === "MPO",
    );
    const fpoStarters = teamRoster.filter(
      (r) => r.is_starter && r.players?.division === "FPO",
    );
    const mpoSlotArr = buildSlotArray(mpoStarters, mpoSlots);
    const fpoSlotArr = buildSlotArray(fpoStarters, fpoSlots);

    const starterRows: (PlayerRow | null)[] = [];
    mpoSlotArr.forEach((spot, i) => {
      starterRows.push(spot ? rowFor(spot, `MPO${i + 1}`) : null);
    });
    fpoSlotArr.forEach((spot, i) => {
      starterRows.push(spot ? rowFor(spot, `FPO${i + 1}`) : null);
    });

    const starterIds = new Set(
      [...mpoSlotArr, ...fpoSlotArr].filter(Boolean).map((r: any) => r.id),
    );
    const benchRows: PlayerRow[] = teamRoster
      .filter((r) => !starterIds.has(r.id))
      .sort((a, b) => {
        const da = a.players?.division === "MPO" ? 0 : 1;
        const db = b.players?.division === "MPO" ? 0 : 1;
        if (da !== db) return da - db;
        return a.id - b.id;
      })
      .map((r) => rowFor(r, "BN"));

    return { starterRows, benchRows };
  }

  const t1Team = buildTeam(matchup.team1_id);
  const t2Team = buildTeam(matchup.team2_id);

  const starterTotal = (rows: (PlayerRow | null)[], pick: (r: PlayerRow) => number | null) =>
    rows.reduce((acc, r) => acc + (r ? (pick(r) ?? 0) : 0), 0);

  const team1Actual = starterTotal(t1Team.starterRows, (r) => r.actual);
  const team2Actual = starterTotal(t2Team.starterRows, (r) => r.actual);
  const finishingFor = (r: PlayerRow) => r.paceProjected ?? r.projected ?? 0;
  const team1Finishing = starterTotal(t1Team.starterRows, finishingFor);
  const team2Finishing = starterTotal(t2Team.starterRows, finishingFor);
  const isFinal = !!matchup.is_final;
  // The headline number is always points actually scored this week (0.0 until
  // the event starts); the projection lives in the ~X line below it.
  const team1Display = isFinal ? matchup.team1_score : team1Actual;
  const team2Display = isFinal ? matchup.team2_score : team2Actual;

  // Win %: residual variance shrinks as the tournament progresses.
  const t1WinPct = winProbability(team1Finishing, team2Finishing, progressFrac);
  const t2WinPct = 100 - t1WinPct;

  const benchPairCount = Math.max(t1Team.benchRows.length, t2Team.benchRows.length);

  // Win-probability history (snapshotted by the gameday pass on each refresh).
  const { data: snapshots } = await supabase
    .from("matchup_prob_snapshots")
    .select("t1_win_pct, created_at")
    .eq("matchup_id", matchup.id)
    .order("created_at", { ascending: true })
    .limit(500);
  const probPoints = (snapshots ?? []).map((s: any) => ({
    pct: s.t1_win_pct as number,
    ts: s.created_at as string,
  }));

  // Live play-by-play for the players in this matchup.
  let feedRows: LiveFeedRow[] = [];
  if (inProgress && weekIds.length > 0 && playerIds.length > 0) {
    const { data: feed } = await supabase
      .from("live_feed_events")
      .select("id, player_id, kind, detail, created_at, players(name)")
      .in("tournament_id", weekIds)
      .in("player_id", playerIds)
      .order("created_at", { ascending: false })
      .limit(30);
    const teamNameByPlayer = new Map<number, string>(
      allRoster.map((r) => [
        r.player_id as number,
        r.team_id === matchup.team1_id ? (team1?.team_name as string) : (team2?.team_name as string),
      ]),
    );
    feedRows = (feed ?? []).map((f: any) => ({
      id: f.id,
      playerName: f.players?.name ?? "Unknown",
      teamName: teamNameByPlayer.get(f.player_id) ?? null,
      kind: f.kind,
      detail: (f.detail ?? {}) as Record<string, unknown>,
      createdAt: f.created_at,
    }));
  }

  const wrapupTeam = (teamName: string, team: { starterRows: (PlayerRow | null)[]; benchRows: PlayerRow[] }) => ({
    teamName,
    starters: team.starterRows.map((r) =>
      r ? { name: r.name, division: r.division, actual: r.actual, projected: r.projected } : null,
    ),
    bench: team.benchRows.map((r) => ({
      name: r.name, division: r.division, actual: r.actual, projected: r.projected,
    })),
    mpoSlots,
    fpoSlots,
  });

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href={`/league/${id}`}
        className="text-gray-400 hover:text-white text-sm transition inline-block"
      >
        ← League
      </Link>

      {inProgress && weekTournamentName && (
        <LiveScoreRefresher tournamentName={weekTournamentName} />
      )}

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between gap-4">
          <TeamHeader
            name={team1.team_name}
            division={team1.division_name}
            score={team1Display}
            projected={team1Finishing}
            isFinal={isFinal}
            inProgress={inProgress}
          />
          <div className="text-center shrink-0">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
              {isFinal ? "Final" : inProgress ? "Live" : "vs"}
            </span>
          </div>
          <TeamHeader
            name={team2.team_name}
            division={team2.division_name}
            score={team2Display}
            projected={team2Finishing}
            isFinal={isFinal}
            inProgress={inProgress}
            right
          />
        </div>

        <p className="text-center text-gray-400 text-xs mt-3">
          Week {matchup.week}
          {weekTournamentName && <> · <span className="text-gray-300">{weekTournamentName}</span></>}
          {weekDateLabel && <span className="text-gray-500"> · {weekDateLabel}</span>}
        </p>

        {!isFinal && (
          <div className="mt-5">
            <div className="h-2 rounded-full bg-white/5 overflow-hidden flex">
              <div className="h-full bg-[#4B3DFF]" style={{ width: `${t1WinPct}%` }} />
              <div className="h-full bg-[#36D7B7]" style={{ width: `${t2WinPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] uppercase tracking-wider mt-2">
              <span className="text-[#4B3DFF] font-semibold">Win {t1WinPct}%</span>
              <span className="text-[#36D7B7] font-semibold">Win {t2WinPct}%</span>
            </div>
          </div>
        )}

        <WinProbChart
          points={probPoints}
          t1Name={team1.team_name}
          t2Name={team2.team_name}
        />
      </div>

      {isFinal && (
        <MatchupWrapup
          t1={wrapupTeam(team1.team_name, t1Team)}
          t2={wrapupTeam(team2.team_name, t2Team)}
        />
      )}

      <LiveEventFeed rows={feedRows} />

      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <SectionHeader
          t1Name={team1.team_name}
          t2Name={team2.team_name}
          label="Starters"
        />
        <div className="divide-y divide-white/5">
          {t1Team.starterRows.map((_, i) => (
            <PairRow
              key={`s-${i}`}
              leagueId={id}
              left={t1Team.starterRows[i]}
              right={t2Team.starterRows[i]}
            />
          ))}
        </div>
      </div>

      {benchPairCount > 0 && (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden mt-4">
          <SectionHeader label="Bench" muted />
          <div className="divide-y divide-white/5">
            {Array.from({ length: benchPairCount }).map((_, i) => (
              <PairRow
                key={`b-${i}`}
                leagueId={id}
                left={t1Team.benchRows[i] ?? null}
                right={t2Team.benchRows[i] ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamHeader({
  name,
  division,
  score,
  projected,
  isFinal,
  inProgress,
  right,
}: {
  name: string;
  division: string | null;
  score: number;
  projected: number;
  isFinal: boolean;
  inProgress: boolean;
  right?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 ${right ? "text-right" : ""}`}>
      <p className="text-white font-bold text-lg truncate">{name}</p>
      {division && <p className="text-gray-400 text-xs mt-0.5">{division}</p>}
      <p className="text-white text-3xl font-black tabular-nums mt-2">{score.toFixed(1)}</p>
      {!isFinal && (
        <p className="text-gray-400 text-xs mt-0.5">
          ~{projected.toFixed(1)} {inProgress ? "final proj" : "projected"}
        </p>
      )}
    </div>
  );
}

function SectionHeader({
  t1Name,
  t2Name,
  label,
  muted,
}: {
  t1Name?: string;
  t2Name?: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_2.5rem_auto_2.5rem_1fr] sm:grid-cols-[1fr_3rem_auto_3rem_1fr] gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-wider font-semibold ${
        muted ? "bg-[#13151b] text-gray-400" : "bg-[#0f1117] text-gray-400"
      }`}
    >
      <span className="truncate">{t1Name ?? ""}</span>
      <span />
      <span className="text-center w-10 sm:w-12">{label}</span>
      <span />
      <span className="text-right truncate">{t2Name ?? ""}</span>
    </div>
  );
}

function PairRow({
  leagueId,
  left,
  right,
}: {
  leagueId: string;
  left: PlayerRow | null;
  right: PlayerRow | null;
}) {
  const slotLabel = left?.slotLabel ?? right?.slotLabel ?? "";
  return (
    <div className="grid grid-cols-[1fr_2.5rem_auto_2.5rem_1fr] sm:grid-cols-[1fr_3rem_auto_3rem_1fr] gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-3 items-center">
      <NameCell row={left} leagueId={leagueId} />
      <PointsCell row={left} align="right" />
      <div className="text-center w-10 sm:w-12 text-gray-400 text-[10px] font-mono uppercase tracking-wider">
        {slotLabel}
      </div>
      <PointsCell row={right} align="left" />
      <NameCell row={right} leagueId={leagueId} right />
    </div>
  );
}

function NameCell({
  row,
  leagueId,
  right,
}: {
  row: PlayerRow | null;
  leagueId: string;
  right?: boolean;
}) {
  if (!row) return <div className={`text-gray-500 text-sm ${right ? "text-right" : ""}`}>—</div>;
  const accent = row.division === "MPO" ? "#4B3DFF" : "#36D7B7";
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <div className={`flex items-center gap-1.5 sm:gap-2 min-w-0 ${right ? "flex-row-reverse" : ""}`}>
        <span
          className="hidden sm:inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
          style={{ color: accent, background: `${accent}20` }}
        >
          {row.division}
        </span>
        <Link
          href={`/league/${leagueId}/player/${row.playerId}`}
          className={`text-sm font-medium truncate hover:underline min-w-0 ${row.isOut ? "text-gray-400" : "text-white"}`}
        >
          {row.name}
        </Link>
        {row.isOut && (
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 text-red-400 bg-red-500/15">
            OUT
          </span>
        )}
      </div>
      {row.nickname && (
        <p className="text-[11px] text-gray-400 leading-tight truncate">({row.nickname})</p>
      )}
      {row.breakdown && (
        <p className="text-[10px] text-gray-500 leading-tight truncate mt-0.5" title={row.breakdown}>
          {row.breakdown}
        </p>
      )}
    </div>
  );
}

/** Colors an actual score relative to its projection: green = beat it,
 *  red = under it, gray = about as expected. */
function colorVsProjection(actual: number, projected: number | null): string {
  if (projected == null || projected <= 0) return "text-white";
  const tol = Math.max(1.5, projected * 0.08);
  const diff = actual - projected;
  if (diff > tol) return "text-[#36D7B7]";
  if (diff < -tol) return "text-red-400";
  return "text-gray-300";
}

function PointsCell({
  row,
  align,
}: {
  row: PlayerRow | null;
  align: "left" | "right";
}) {
  if (!row) return <div />;
  const alignClass = align === "right" ? "text-right" : "text-left";

  // Pre-event: projection only (0.0 in red when the player is OUT).
  if (row.actual == null) {
    if (row.isOut) {
      return <p className={`text-sm tabular-nums font-semibold text-red-400 ${alignClass}`}>0.0</p>;
    }
    return (
      <p className={`text-sm tabular-nums font-semibold text-gray-400 ${alignClass}`}>
        {row.projected != null ? `~${row.projected.toFixed(1)}` : "—"}
      </p>
    );
  }

  // Live (event in progress): actual on top, pace projection (vs projection) below.
  if (row.paceProjected != null) {
    return (
      <div className={alignClass}>
        <p className="text-white text-sm font-semibold tabular-nums">{row.actual.toFixed(1)}</p>
        <p className={`text-[10px] tabular-nums ${colorVsProjection(row.paceProjected, row.projected)}`}>
          ~{row.paceProjected.toFixed(1)}
        </p>
      </div>
    );
  }

  // Final / past: actual colored vs projection, with the projection in gray below.
  return (
    <div className={alignClass}>
      <p className={`text-sm font-semibold tabular-nums ${colorVsProjection(row.actual, row.projected)}`}>
        {row.actual.toFixed(1)}
      </p>
      {row.projected != null && (
        <p className="text-[10px] tabular-nums text-gray-500">~{row.projected.toFixed(1)}</p>
      )}
    </div>
  );
}
