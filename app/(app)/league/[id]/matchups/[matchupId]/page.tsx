import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LIVE_END_GRACE_MS } from "@/lib/live-window";
import { buildWeekProjections, type MatchupPlayerRow } from "@/lib/matchup-projections";
import { resolveScoringRules, describeScoreContributions } from "@/lib/scoring-rules";
import { LiveScoreRefresher } from "@/components/live-score-refresher";
import { WinProbChart } from "@/components/win-prob-chart";
import { LiveEventFeed, type LiveFeedRow } from "@/components/live-event-feed";
import { MatchupWrapup } from "@/components/matchup-wrapup";

/** Shared week row + the two per-team display extras this page adds. */
type PlayerRow = MatchupPlayerRow & {
  nickname: string | null;
  breakdown: string | null;
};

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
      team1:league_members!matchups_team1_id_fkey(id, team_name, division_name, profiles(avatar_url, avatar_color)),
      team2:league_members!matchups_team2_id_fkey(id, team_name, division_name, profiles(avatar_url, avatar_color))
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
  const rules = resolveScoringRules((league as any)?.scoring_rules);

  const team1 = matchup.team1 as any;
  const team2 = matchup.team2 as any;

  // Every matchup surface (dashboard, matchups list, this page) reads its
  // numbers from buildWeekProjections so the same matchup can't project or
  // win-percentage differently depending on where you look at it. `matchup.week`
  // is the league's own week index — the helper resolves it to the week's event
  // through the league schedule.
  const wk = await buildWeekProjections(supabase, {
    leagueId: Number(id),
    week: matchup.week,
    league: league as any,
    teamIds: [matchup.team1_id, matchup.team2_id],
  });
  const { inProgress, ended, settled } = wk;
  const weekTournamentName = wk.eventName;
  const weekDateLabel = wk.eventDateLabel;
  const weekIds = wk.tournamentIds;
  // Keep polling for a grace window past the UTC end so late-posted Sunday
  // final-round results still flow in before the Monday finalize.
  const pollLive =
    inProgress || (ended && wk.eventEndMs != null && Date.now() <= wk.eventEndMs + LIVE_END_GRACE_MS);

  // Per-team player nicknames (shown under each name on this matchup).
  const { data: nickRows } = await supabase
    .from("player_nicknames")
    .select("team_id, player_id, nickname")
    .in("team_id", [matchup.team1_id, matchup.team2_id]);
  const nickByTeamPlayer = new Map<string, string>(
    (nickRows ?? []).map((n: any) => [`${n.team_id}:${n.player_id}`, n.nickname as string]),
  );

  // Decorate the shared rows with this page's nickname + score-breakdown lines.
  const decorate = (teamId: number, row: MatchupPlayerRow | null): PlayerRow | null =>
    row
      ? {
          ...row,
          nickname: nickByTeamPlayer.get(`${teamId}:${row.playerId}`) ?? null,
          breakdown:
            row.actual != null && row.weekStat
              ? describeScoreContributions(rules, row.weekStat)
              : null,
        }
      : null;
  const buildTeam = (teamId: number) => {
    const t = wk.teamNumbers(teamId);
    return {
      starterRows: t.starters.map((r) => decorate(teamId, r)),
      benchRows: t.bench.map((r) => decorate(teamId, r)!) as PlayerRow[],
      actual: t.actual,
      finishing: t.finishing,
    };
  };

  const t1Team = buildTeam(matchup.team1_id);
  const t2Team = buildTeam(matchup.team2_id);

  const team1Finishing = t1Team.finishing;
  const team2Finishing = t2Team.finishing;
  const isFinal = !!matchup.is_final;
  // The headline number is always points actually scored this week (0.0 until
  // the event starts); the projection lives in the ~X line below it.
  const team1Display = isFinal ? matchup.team1_score : t1Team.actual;
  const team2Display = isFinal ? matchup.team2_score : t2Team.actual;

  // Win %: residual variance shrinks as the tournament progresses.
  const t1WinPct = wk.winPctFor(matchup.team1_id, matchup.team2_id);
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
  const teamNameByPlayer = new Map<number, string>();
  for (const [team, name] of [
    [t1Team, team1?.team_name as string],
    [t2Team, team2?.team_name as string],
  ] as const) {
    for (const r of [...team.starterRows, ...team.benchRows]) {
      if (r) teamNameByPlayer.set(r.playerId, name);
    }
  }
  const playerIds = [...teamNameByPlayer.keys()];
  let feedRows: LiveFeedRow[] = [];
  if (inProgress && weekIds.length > 0 && playerIds.length > 0) {
    const { data: feed } = await supabase
      .from("live_feed_events")
      .select("id, player_id, kind, detail, created_at, players(name)")
      .in("tournament_id", weekIds)
      .in("player_id", playerIds)
      .order("created_at", { ascending: false })
      .limit(30);
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
    mpoSlots: wk.mpoSlots,
    fpoSlots: wk.fpoSlots,
  });

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href={`/league/${id}`}
        className="text-gray-400 hover:text-white text-sm transition inline-block"
      >
        ← League
      </Link>

      {pollLive && weekTournamentName && (
        <LiveScoreRefresher tournamentName={weekTournamentName} />
      )}

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between gap-4">
          <TeamHeader
            name={team1.team_name}
            division={team1.division_name}
            avatarUrl={(team1 as any).profiles?.avatar_url ?? null}
            avatarColor={(team1 as any).profiles?.avatar_color ?? null}
            score={team1Display}
            projected={team1Finishing}
            isFinal={isFinal || settled}
            inProgress={inProgress}
          />
          <div className="text-center shrink-0">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
              {isFinal ? "Final" : inProgress ? "Live" : settled ? "Unofficial" : "vs"}
            </span>
          </div>
          <TeamHeader
            name={team2.team_name}
            division={team2.division_name}
            avatarUrl={(team2 as any).profiles?.avatar_url ?? null}
            avatarColor={(team2 as any).profiles?.avatar_color ?? null}
            score={team2Display}
            projected={team2Finishing}
            isFinal={isFinal || settled}
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
  avatarUrl,
  avatarColor,
  score,
  projected,
  isFinal,
  inProgress,
  right,
}: {
  name: string;
  division: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  score: number;
  projected: number;
  isFinal: boolean;
  inProgress: boolean;
  right?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 ${right ? "text-right" : ""}`}>
      <div className={`flex items-center gap-2.5 ${right ? "flex-row-reverse" : ""}`}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 bg-white/10" />
        ) : (
          <div
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: avatarColor ?? "#4B3DFF" }}
          >
            {name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-white font-bold text-lg truncate">{name}</p>
          {division && <p className="text-gray-400 text-xs mt-0.5">{division}</p>}
        </div>
      </div>
      <p className="text-white text-3xl font-black tabular-nums mt-2">{score.toFixed(1)}</p>
      {!isFinal && (
        <p className="text-gray-400 text-sm tabular-nums mt-0.5">{projected.toFixed(1)}</p>
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
        {row.projected != null ? row.projected.toFixed(1) : "—"}
      </p>
    );
  }

  // Live (event in progress): actual on top, pace projection (vs projection) below.
  if (row.paceProjected != null) {
    return (
      <div className={alignClass}>
        <p className="text-white text-sm font-semibold tabular-nums">{row.actual.toFixed(1)}</p>
        <p className={`text-xs tabular-nums ${colorVsProjection(row.paceProjected, row.projected)}`}>
          {row.paceProjected.toFixed(1)}
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
        <p className="text-xs tabular-nums text-gray-500">{row.projected.toFixed(1)}</p>
      )}
    </div>
  );
}
