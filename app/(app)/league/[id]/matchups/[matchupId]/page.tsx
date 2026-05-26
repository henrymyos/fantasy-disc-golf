import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyProjectionVariance } from "@/lib/projections";
import { getActiveTournament } from "@/lib/lineup-lock";

type PlayerRow = {
  rosterId: number;
  playerId: number;
  name: string;
  division: "MPO" | "FPO";
  slotLabel: string;
  actual: number | null;
  projected: number | null;
  paceProjected: number | null;
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
    .select("mpo_starters, fpo_starters")
    .eq("id", id)
    .single();
  const mpoSlots: number = (league as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (league as any)?.fpo_starters ?? 2;

  const team1 = matchup.team1 as any;
  const team2 = matchup.team2 as any;

  const activeTournament = await getActiveTournament(supabase);
  const todayIso = new Date().toISOString().slice(0, 10);
  let nextTournamentId: number | null = activeTournament?.id ?? null;
  if (!nextTournamentId) {
    const { data: upcoming } = await supabase
      .from("tournaments")
      .select("id, name")
      .gte("start_date", todayIso)
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    nextTournamentId = (upcoming as any)?.id ?? null;
  }

  const inProgress = activeTournament !== null;
  let progressFrac = 0;
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

  const { data: roster } = await supabase
    .from("rosters")
    .select("id, team_id, player_id, is_starter, lineup_order, players(name, division)")
    .eq("league_id", id)
    .in("team_id", [matchup.team1_id, matchup.team2_id])
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  const allRoster = (roster ?? []) as any[];

  const playerIds = allRoster.map((r) => r.player_id);
  const { data: results } = playerIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, fantasy_points")
        .in("player_id", playerIds)
    : { data: [] };

  const totals = new Map<number, { sum: number; count: number }>();
  const actuals = new Map<number, number>();
  (results ?? []).forEach((r: any) => {
    const cur = totals.get(r.player_id) ?? { sum: 0, count: 0 };
    cur.sum += Number(r.fantasy_points ?? 0);
    cur.count += 1;
    totals.set(r.player_id, cur);
    if (nextTournamentId != null && r.tournament_id === nextTournamentId) {
      actuals.set(r.player_id, (actuals.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
    }
  });

  function rowFor(s: any, slotLabel: string): PlayerRow {
    const t = totals.get(s.player_id);
    const actual = actuals.has(s.player_id)
      ? Math.round(actuals.get(s.player_id)! * 10) / 10
      : null;
    const projected = t && t.count > 0
      ? applyProjectionVariance(t.sum / t.count, s.player_id, 3)
      : null;
    let paceProjected: number | null = null;
    if (inProgress && actual != null) {
      paceProjected = Math.round((actual / paceDivisor) * 10) / 10;
    }
    return {
      rosterId: s.id,
      playerId: s.player_id,
      name: s.players?.name ?? "Unknown",
      division: (s.players?.division as "MPO" | "FPO") ?? "MPO",
      slotLabel,
      actual,
      projected,
      paceProjected,
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
  const team1Proj = starterTotal(t1Team.starterRows, (r) => r.projected);
  const team2Proj = starterTotal(t2Team.starterRows, (r) => r.projected);
  const finishingFor = (r: PlayerRow) => r.paceProjected ?? r.projected ?? 0;
  const team1Finishing = starterTotal(t1Team.starterRows, finishingFor);
  const team2Finishing = starterTotal(t2Team.starterRows, finishingFor);
  const isFinal = !!matchup.is_final;
  const team1Display = isFinal
    ? matchup.team1_score
    : inProgress
      ? team1Actual
      : team1Proj;
  const team2Display = isFinal
    ? matchup.team2_score
    : inProgress
      ? team2Actual
      : team2Proj;

  // Win %: residual variance shrinks as the tournament progresses.
  const baseSigma = 12;
  const sigma = baseSigma * Math.sqrt(Math.max(0.05, 1 - progressFrac));
  const z = (team1Finishing - team2Finishing) / Math.sqrt(2 * sigma * sigma);
  const t1WinPct = Math.round(normalCdf(z) * 100);
  const t2WinPct = 100 - t1WinPct;

  const benchPairCount = Math.max(t1Team.benchRows.length, t2Team.benchRows.length);

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href={`/league/${id}`}
        className="text-gray-400 hover:text-white text-sm transition inline-block"
      >
        ← League
      </Link>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between gap-4">
          <TeamHeader
            name={team1.team_name}
            division={team1.division_name}
            score={team1Display}
            projected={team1Finishing}
            winPct={t1WinPct}
            isFinal={isFinal}
            inProgress={inProgress}
          />
          <div className="text-center shrink-0">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
              {isFinal ? "Final" : inProgress ? "Live" : `Week ${matchup.week}`}
            </span>
          </div>
          <TeamHeader
            name={team2.team_name}
            division={team2.division_name}
            score={team2Display}
            projected={team2Finishing}
            winPct={t2WinPct}
            isFinal={isFinal}
            inProgress={inProgress}
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
  winPct,
  isFinal,
  inProgress,
  right,
}: {
  name: string;
  division: string | null;
  score: number;
  projected: number;
  winPct: number;
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
      className={`grid grid-cols-[1fr_3rem_auto_3rem_1fr] gap-2 px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-wider font-semibold ${
        muted ? "bg-[#13151b] text-gray-400" : "bg-[#0f1117] text-gray-400"
      }`}
    >
      <span>{t1Name ?? ""}</span>
      <span />
      <span className="text-center w-12">{label}</span>
      <span />
      <span className="text-right">{t2Name ?? ""}</span>
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
    <div className="grid grid-cols-[1fr_3rem_auto_3rem_1fr] gap-2 px-4 py-3 items-center">
      <NameCell row={left} leagueId={leagueId} />
      <PointsCell row={left} align="right" />
      <div className="text-center w-12 text-gray-400 text-[10px] font-mono uppercase tracking-wider">
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
    <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
      <span
        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
        style={{ color: accent, background: `${accent}20` }}
      >
        {row.division}
      </span>
      <Link
        href={`/league/${leagueId}/player/${row.playerId}`}
        className="text-white text-sm font-medium truncate hover:underline min-w-0"
      >
        {row.name}
      </Link>
    </div>
  );
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
  const display = row.actual != null
    ? `${row.actual.toFixed(1)}`
    : row.projected != null
      ? `~${row.projected.toFixed(1)}`
      : "—";
  return (
    <p
      className={`text-sm tabular-nums font-semibold ${
        row.actual != null ? "text-[#36D7B7]" : "text-gray-400"
      } ${alignClass}`}
    >
      {display}
    </p>
  );
}
