import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyProjectionVariance } from "@/lib/projections";
import { getActiveTournament } from "@/lib/lineup-lock";

type StarterRow = {
  rosterId: number;
  playerId: number;
  name: string;
  division: "MPO" | "FPO";
  actual: number | null;
  projected: number | null;
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
      team1:league_members!matchups_team1_id_fkey(id, team_name, division_name),
      team2:league_members!matchups_team2_id_fkey(id, team_name, division_name)
    `)
    .eq("id", matchupId)
    .eq("league_id", id)
    .single();
  if (!matchup) notFound();

  const team1 = matchup.team1 as any;
  const team2 = matchup.team2 as any;

  // Pick the upcoming/active event for projection vs actual comparison.
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

  // Fetch both teams' starters with player info.
  const { data: starters } = await supabase
    .from("rosters")
    .select("id, team_id, player_id, lineup_order, players(name, division)")
    .eq("league_id", id)
    .in("team_id", [matchup.team1_id, matchup.team2_id])
    .eq("is_starter", true)
    .order("lineup_order", { ascending: true, nullsFirst: false });

  const playerIds = (starters ?? []).map((s: any) => s.player_id);
  const { data: results } = playerIds.length > 0
    ? await supabase
        .from("tournament_results")
        .select("player_id, tournament_id, fantasy_points")
        .in("player_id", playerIds)
    : { data: [] };

  const totalByPlayer = new Map<number, { sum: number; count: number }>();
  const weekActualByPlayer = new Map<number, number>();
  (results ?? []).forEach((r: any) => {
    const cur = totalByPlayer.get(r.player_id) ?? { sum: 0, count: 0 };
    cur.sum += Number(r.fantasy_points ?? 0);
    cur.count += 1;
    totalByPlayer.set(r.player_id, cur);
    if (nextTournamentId != null && r.tournament_id === nextTournamentId) {
      weekActualByPlayer.set(r.player_id, (weekActualByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
    }
  });

  function rowFor(s: any): StarterRow {
    const totals = totalByPlayer.get(s.player_id);
    const actual = weekActualByPlayer.has(s.player_id)
      ? Math.round(weekActualByPlayer.get(s.player_id)! * 10) / 10
      : null;
    const projected = totals && totals.count > 0
      ? applyProjectionVariance(totals.sum / totals.count, s.player_id, 3)
      : null;
    return {
      rosterId: s.id,
      playerId: s.player_id,
      name: s.players?.name ?? "Unknown",
      division: (s.players?.division as "MPO" | "FPO") ?? "MPO",
      actual,
      projected,
    };
  }

  const team1Starters = (starters ?? []).filter((s: any) => s.team_id === matchup.team1_id).map(rowFor);
  const team2Starters = (starters ?? []).filter((s: any) => s.team_id === matchup.team2_id).map(rowFor);

  const sumActual = (rows: StarterRow[]) =>
    rows.reduce((acc, r) => acc + (r.actual ?? 0), 0);
  const sumProjected = (rows: StarterRow[]) =>
    rows.reduce((acc, r) => acc + (r.projected ?? 0), 0);

  const team1Actual = sumActual(team1Starters);
  const team2Actual = sumActual(team2Starters);
  const team1Proj = sumProjected(team1Starters);
  const team2Proj = sumProjected(team2Starters);
  const isFinal = !!matchup.is_final;
  const team1Display = isFinal ? matchup.team1_score : team1Actual || team1Proj;
  const team2Display = isFinal ? matchup.team2_score : team2Actual || team2Proj;

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href={`/league/${id}`}
        className="text-gray-400 hover:text-white text-sm transition inline-block"
      >
        ← League
      </Link>

      {/* Header: team A vs team B, totals in middle */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between gap-4">
          <TeamHeader
            name={team1.team_name}
            division={team1.division_name}
            score={team1Display}
            projected={team1Proj}
            isFinal={isFinal}
          />
          <div className="text-center shrink-0">
            <span className="text-gray-600 text-xs font-bold uppercase tracking-widest">
              {isFinal ? "Final" : `Week ${matchup.week}`}
            </span>
          </div>
          <TeamHeader
            name={team2.team_name}
            division={team2.division_name}
            score={team2Display}
            projected={team2Proj}
            isFinal={isFinal}
            right
          />
        </div>
      </div>

      {/* Starter lineup side-by-side, scores in the middle */}
      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-4 py-2 bg-[#0f1117] border-b border-white/5 text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          <span>{team1.team_name}</span>
          <span className="text-center w-20">Pts</span>
          <span className="text-right">{team2.team_name}</span>
        </div>
        <StarterPairList
          leagueId={id}
          left={team1Starters}
          right={team2Starters}
          isFinal={isFinal}
        />
      </div>
    </div>
  );
}

function TeamHeader({
  name,
  division,
  score,
  projected,
  isFinal,
  right,
}: {
  name: string;
  division: string | null;
  score: number;
  projected: number;
  isFinal: boolean;
  right?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 ${right ? "text-right" : ""}`}>
      <p className="text-white font-bold text-lg truncate">{name}</p>
      {division && <p className="text-gray-500 text-xs mt-0.5">{division}</p>}
      <p className="text-white text-3xl font-black tabular-nums mt-2">{score.toFixed(1)}</p>
      {!isFinal && projected > 0 && (
        <p className="text-gray-500 text-xs mt-0.5">~{projected.toFixed(1)} projected</p>
      )}
    </div>
  );
}

function StarterPairList({
  leagueId,
  left,
  right,
  isFinal,
}: {
  leagueId: string;
  left: StarterRow[];
  right: StarterRow[];
  isFinal: boolean;
}) {
  const rows = Math.max(left.length, right.length);
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: rows }).map((_, i) => (
        <StarterPairRow
          key={i}
          leagueId={leagueId}
          a={left[i] ?? null}
          b={right[i] ?? null}
          isFinal={isFinal}
        />
      ))}
    </div>
  );
}

function StarterPairRow({
  leagueId,
  a,
  b,
  isFinal,
}: {
  leagueId: string;
  a: StarterRow | null;
  b: StarterRow | null;
  isFinal: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-4 py-3 items-center">
      <PlayerCell row={a} leagueId={leagueId} isFinal={isFinal} />
      <div className="text-center w-20 text-gray-600 text-xs font-mono">vs</div>
      <PlayerCell row={b} leagueId={leagueId} isFinal={isFinal} right />
    </div>
  );
}

function PlayerCell({
  row,
  leagueId,
  isFinal,
  right,
}: {
  row: StarterRow | null;
  leagueId: string;
  isFinal: boolean;
  right?: boolean;
}) {
  if (!row) return <div className={right ? "text-right" : ""}>—</div>;
  const accent = row.division === "MPO" ? "#4B3DFF" : "#36D7B7";
  const display = row.actual != null ? `${row.actual.toFixed(1)}` : row.projected != null ? `~${row.projected.toFixed(1)}` : "—";
  return (
    <div className={`flex items-center gap-2 min-w-0 ${right ? "flex-row-reverse text-right" : ""}`}>
      <span
        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
        style={{ color: accent, background: `${accent}20` }}
      >
        {row.division}
      </span>
      <div className="min-w-0">
        <Link
          href={`/league/${leagueId}/player/${row.playerId}`}
          className="text-white text-sm font-medium truncate hover:underline block"
        >
          {row.name}
        </Link>
        <p
          className={`text-xs tabular-nums ${row.actual != null ? "text-[#36D7B7]" : "text-gray-500"}`}
        >
          {display}
        </p>
      </div>
    </div>
  );
}
