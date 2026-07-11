import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyProjectionVariance } from "@/lib/projections";
import { getActiveTournament } from "@/lib/lineup-lock";
import { fantasyPointsFromResult, resolveScoringRules, describeScoreContributions } from "@/lib/scoring-rules";

type StarterRow = {
  rosterId: number;
  playerId: number;
  name: string;
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

// Standard-normal CDF via Abramowitz & Stegun 7.1.26 approximation.
function normalCdf(x: number): number {
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

export default async function MyMatchupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, mpo_starters, fpo_starters, scoring_rules")
    .eq("id", id)
    .single();
  if (!league) notFound();

  // Score live under THIS league's rules (placement table + bonus values), not
  // the default-rule fantasy_points stored on the shared results row.
  const rules = resolveScoringRules((league as any).scoring_rules);

  const mpoSlots: number = (league as any).mpo_starters ?? 4;
  const fpoSlots: number = (league as any).fpo_starters ?? 2;

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!myMember) redirect(`/league/${id}`);

  // Find my current-week matchup; fall back to next scheduled if none yet.
  let { data: matchup } = await supabase
    .from("matchups")
    .select(
      "id, week, team1_id, team2_id, team1_score, team2_score, is_final, team1:league_members!matchups_team1_id_fkey(id, team_name), team2:league_members!matchups_team2_id_fkey(id, team_name)",
    )
    .eq("league_id", id)
    .eq("week", league.current_week)
    .or(`team1_id.eq.${myMember.id},team2_id.eq.${myMember.id}`)
    .maybeSingle();
  if (!matchup) {
    const { data: upcoming } = await supabase
      .from("matchups")
      .select(
        "id, week, team1_id, team2_id, team1_score, team2_score, is_final, team1:league_members!matchups_team1_id_fkey(id, team_name), team2:league_members!matchups_team2_id_fkey(id, team_name)",
      )
      .eq("league_id", id)
      .eq("is_final", false)
      .or(`team1_id.eq.${myMember.id},team2_id.eq.${myMember.id}`)
      .order("week", { ascending: true })
      .limit(1)
      .maybeSingle();
    matchup = upcoming;
  }

  if (!matchup) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-white font-bold text-xl mb-2">Your Matchup</h2>
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">
            No matchup scheduled for you yet. Check back once the regular season starts.
          </p>
        </div>
      </div>
    );
  }

  const t1 = (matchup as any).team1;
  const t2 = (matchup as any).team2;
  const t1Id = (matchup as any).team1_id;
  const t2Id = (matchup as any).team2_id;

  // Active/upcoming tournament for the actual-vs-projected split + registration.
  const activeTournament = await getActiveTournament(supabase, Number(id));
  const todayIso = new Date().toISOString().slice(0, 10);
  let weekTournamentId: number | null = activeTournament?.id ?? null;
  if (!weekTournamentId) {
    const { data: upcomingT } = await supabase
      .from("tournaments")
      .select("id")
      .gte("start_date", todayIso)
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    weekTournamentId = (upcomingT as any)?.id ?? null;
  }

  // Registered-player set + the event name/dates for this week's matchup.
  let registeredSet: Set<number> | null = null;
  let weekTournamentName: string | null = activeTournament?.name ?? null;
  if (weekTournamentId != null) {
    const { data: regRow } = await supabase
      .from("tournaments")
      .select("name, registered_player_ids")
      .eq("id", weekTournamentId)
      .maybeSingle();
    const ids = (regRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) registeredSet = new Set(ids);
    weekTournamentName = (regRow as any)?.name ?? weekTournamentName;
  }

  // When a tournament is active, estimate how far through it we are so we
  // can pace-project each player's final score. `lock_at` is round-1 tee
  // time; `end_date` is the last competition day.
  const inProgress = activeTournament !== null;
  let progressFrac = 0;
  if (inProgress && activeTournament) {
    const startMs = activeTournament.lock_at
      ? Date.parse(activeTournament.lock_at)
      : Date.parse(`${activeTournament.start_date}T00:00:00Z`);
    // Treat the end-date day as ending at 23:59:59 UTC.
    const endMs = Date.parse(`${activeTournament.end_date}T23:59:59Z`);
    const span = endMs - startMs;
    if (Number.isFinite(span) && span > 0) {
      progressFrac = Math.min(1, Math.max(0, (Date.now() - startMs) / span));
    }
  }
  // Clamp the pace divisor so a player with a real-but-small actual at hour
  // 1 doesn't get a hugely inflated finishing projection.
  const paceDivisor = Math.max(progressFrac, 0.1);

  const { data: roster } = await supabase
    .from("rosters")
    .select("id, team_id, player_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", id)
    .in("team_id", [t1Id, t2Id])
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const allRoster = (roster ?? []) as any[];
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
    // Recompute per-player points under the league's rules (incl. the
    // provisional hot-round bonus, which the import re-derives against the
    // field on every refresh).
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
    if (weekTournamentId != null && r.tournament_id === weekTournamentId) {
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

  function rowFor(s: any, slotLabel: string): StarterRow {
    const t = totals.get(s.player_id);
    const actual = actuals.has(s.player_id)
      ? Math.round(actuals.get(s.player_id)! * 10) / 10
      : null;
    const seasonProjected = t && t.count > 0
      ? applyProjectionVariance(t.sum / t.count, s.player_id, 3)
      : null;
    // OUT: player is not registered for the target event (and hasn't already
    // posted a score this event).
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

    const starterRows: (StarterRow | null)[] = [];
    mpoSlotArr.forEach((spot, i) => {
      starterRows.push(spot ? rowFor(spot, `MPO${i + 1}`) : null);
    });
    fpoSlotArr.forEach((spot, i) => {
      starterRows.push(spot ? rowFor(spot, `FPO${i + 1}`) : null);
    });

    const starterIds = new Set(
      [...mpoSlotArr, ...fpoSlotArr].filter(Boolean).map((r: any) => r.id),
    );
    const benchRows: StarterRow[] = teamRoster
      .filter((r) => !starterIds.has(r.id))
      .sort((a, b) => {
        // MPO first, then FPO, then by id (preserves the lineup_order/id query order).
        const da = a.players?.division === "MPO" ? 0 : 1;
        const db = b.players?.division === "MPO" ? 0 : 1;
        if (da !== db) return da - db;
        return a.id - b.id;
      })
      .map((r) => rowFor(r, "BN"));

    return { starterRows, benchRows };
  }

  const t1Team = buildTeam(t1Id);
  const t2Team = buildTeam(t2Id);

  const starterTotal = (rows: (StarterRow | null)[], pick: (r: StarterRow) => number | null) =>
    rows.reduce((acc, r) => acc + (r ? (pick(r) ?? 0) : 0), 0);

  const t1Proj = starterTotal(t1Team.starterRows, (r) => r.projected);
  const t2Proj = starterTotal(t2Team.starterRows, (r) => r.projected);
  const t1Actual = starterTotal(t1Team.starterRows, (r) => r.actual);
  const t2Actual = starterTotal(t2Team.starterRows, (r) => r.actual);
  // Each player's expected finishing total: their live pace if scored,
  // otherwise the pre-event season projection.
  const finishingFor = (r: StarterRow) => r.paceProjected ?? r.projected ?? 0;
  const t1Finishing = starterTotal(t1Team.starterRows, finishingFor);
  const t2Finishing = starterTotal(t2Team.starterRows, finishingFor);
  const isFinal = !!(matchup as any).is_final;
  const t1Display = isFinal
    ? Number((matchup as any).team1_score)
    : inProgress
      ? t1Actual
      : t1Proj;
  const t2Display = isFinal
    ? Number((matchup as any).team2_score)
    : inProgress
      ? t2Actual
      : t2Proj;

  // Win % uses each team's *finishing* estimate (pace where available),
  // and the residual variance shrinks as the tournament progresses.
  const baseSigma = 28;
  const sigma = baseSigma * Math.sqrt(Math.max(0.05, 1 - progressFrac));
  const z = (t1Finishing - t2Finishing) / Math.sqrt(2 * sigma * sigma);
  const t1WinPct = Math.round(normalCdf(z) * 100);
  const t2WinPct = 100 - t1WinPct;
  const isMine = (id: number) => id === myMember.id;

  // Pad the two teams' bench lists to the same length for paired rendering.
  const benchPairCount = Math.max(t1Team.benchRows.length, t2Team.benchRows.length);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-white font-bold text-xl">Your Matchup</h2>
        <p className="text-gray-400 text-sm mt-1">
          Week {(matchup as any).week}
          {weekTournamentName && <> · <span className="text-gray-300">{weekTournamentName}</span></>}
          {isFinal ? " · Final" : " · live projection"}
        </p>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-end">
          <TeamHeader
            name={t1?.team_name ?? "TBD"}
            score={t1Display}
            projected={t1Finishing}
            winPct={t1WinPct}
            isFinal={isFinal}
            inProgress={inProgress}
            isMine={isMine(t1Id)}
          />
          <div className="text-center pb-3">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
              {isFinal ? "Final" : inProgress ? "Live" : "vs"}
            </span>
          </div>
          <TeamHeader
            name={t2?.team_name ?? "TBD"}
            score={t2Display}
            projected={t2Finishing}
            winPct={t2WinPct}
            isFinal={isFinal}
            inProgress={inProgress}
            isMine={isMine(t2Id)}
            right
          />
        </div>

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
      </div>

      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <SectionHeader t1Name={t1?.team_name} t2Name={t2?.team_name} label="Starters" />
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

      <div className="flex justify-end">
        <Link
          href={`/league/${id}/matchups`}
          className="text-gray-400 hover:text-white text-xs"
        >
          See all matchups →
        </Link>
      </div>
    </div>
  );
}

function TeamHeader({
  name,
  score,
  projected,
  winPct,
  isFinal,
  inProgress,
  isMine,
  right,
}: {
  name: string;
  score: number;
  projected: number;
  winPct: number;
  isFinal: boolean;
  inProgress: boolean;
  isMine: boolean;
  right?: boolean;
}) {
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <p className="text-white font-bold text-lg truncate">
        {name}
        {isMine && <span className="text-gray-400 text-xs font-normal ml-2">(you)</span>}
      </p>
      <p className="text-white text-3xl font-black tabular-nums mt-2">{score.toFixed(1)}</p>
      {!isFinal && (
        <p className="text-gray-400 text-xs mt-1">
          ~{projected.toFixed(1)} {inProgress ? "final proj" : "projected"} ·{" "}
          <span className="text-white font-semibold">{winPct}%</span> win
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
  left: StarterRow | null;
  right: StarterRow | null;
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
  row: StarterRow | null;
  leagueId: string;
  right?: boolean;
}) {
  if (!row) return <div className={`text-gray-400 text-sm ${right ? "text-right" : ""}`}>—</div>;
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
      {row.breakdown && (
        <p className="text-[10px] text-gray-500 leading-tight truncate mt-0.5" title={row.breakdown}>
          {row.breakdown}
        </p>
      )}
    </div>
  );
}

function PointsCell({
  row,
  align,
}: {
  row: StarterRow | null;
  align: "left" | "right";
}) {
  if (!row) return <div />;
  const alignClass = align === "right" ? "text-right" : "text-left";

  // Pre-event: just show projected (0.0 in red when the player is OUT).
  if (row.actual == null) {
    if (row.isOut) {
      return (
        <p className={`text-sm tabular-nums font-semibold text-red-400 ${alignClass}`}>
          0.0
        </p>
      );
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
