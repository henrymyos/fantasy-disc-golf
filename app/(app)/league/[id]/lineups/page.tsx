import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LineupSlot, BenchSlot, PlayerPhoto, WeekPointsBadge } from "@/components/lineup-slot";
import { TeamActionsPanel } from "@/components/team-actions-panel";
import { getActiveTournament } from "@/lib/lineup-lock";
import { getPollableTournament } from "@/lib/live-window";
import { featuredWeekFor, getLeagueNextTournamentId, getLeagueSchedule, weekTabsFor } from "@/lib/league-schedule";
import { getLineupPlan, getLineupSnapshot, lineupPlansAvailable, type PlannedStarter } from "@/lib/lineup-plans";
import { LiveScoreRefresher } from "@/components/live-score-refresher";
import { WeekSwitcher } from "@/components/week-switcher";
import { WeekLineupEditor, type EditorPlayer } from "@/components/week-lineup-editor";
import { loadPlayerPoints } from "@/lib/player-points";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";
import { optimizeLineup } from "@/actions/rosters";

export default async function LineupsPage({
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
    .select("id, starters_count, roster_size, current_week, scoring_rules")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: divData } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters, scoring_mode")
    .eq("id", id)
    .single();

  const mpoSlots: number = (divData as any)?.mpo_starters ?? 4;
  const fpoSlots: number = (divData as any)?.fpo_starters ?? 2;
  const scoringMode = (((divData as any)?.scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard?home=1");

  // ── Week selection ──────────────────────────────────────────────────────────
  // Every league week is navigable: past weeks are read-only history, the
  // current week is the live editable lineup, and future weeks edit a staged
  // plan that becomes the real lineup when the week arrives.
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
  const mode: "past" | "current" | "future" =
    selectedWeek < currentWeek ? "past" : selectedWeek > currentWeek ? "future" : "current";
  const weekTabs = schedule ? weekTabsFor(schedule) : [];
  const weekTid: number | null =
    schedule?.weekToTournamentIds.get(selectedWeek)?.[0] ?? null;

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, lineup_order, players(id, name, division, avatar_url)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const roster = (myRoster ?? []) as any[];

  // Attach this team's player nicknames, shown under each name.
  const { data: nickRows } = await supabase
    .from("player_nicknames")
    .select("player_id, nickname")
    .eq("team_id", myMember.id);
  const nickByPlayer = new Map<number, string>(
    (nickRows ?? []).map((n: any) => [n.player_id as number, n.nickname as string]),
  );
  for (const r of roster) {
    r.nickname = nickByPlayer.get(r.player_id) ?? null;
  }

  const activeTournament = mode === "current" ? await getActiveTournament(supabase, Number(id)) : null;
  const lineupLocked = activeTournament !== null;
  // Live or recently-ended event — keeps the score poller running and the
  // week's actuals on screen through the post-event grace window.
  const pollableTournament = await getPollableTournament(supabase, Number(id));

  // Per-player projected and actual points for the SELECTED week's event.
  // Current week keeps the live chain (active → pollable → next scheduled);
  // other weeks target that week's own event.
  const playerIds = roster.map((r: any) => r.player_id);
  const nextTournamentId: number | null =
    mode === "current"
      ? activeTournament?.id
        ?? (pollableTournament != null && pollableTournament.id > 0 ? pollableTournament.id : null)
        ?? weekTid
        ?? (await getLeagueNextTournamentId(supabase, Number(id)))
      : weekTid;

  // Scored under THIS league's rules (matching the matchup pages), paged past
  // the 1000-row select cap.
  const points = await loadPlayerPoints(supabase, {
    rules: (league as any).scoring_rules,
    playerIds,
  });

  // Registered set for the target tournament — anyone not in it is OUT.
  let registeredSet: Set<number> | null = null;
  if (nextTournamentId != null) {
    const { data: regRow } = await supabase
      .from("tournaments")
      .select("registered_player_ids")
      .eq("id", nextTournamentId)
      .maybeSingle();
    const ids = (regRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) registeredSet = new Set(ids);
  }

  // playerId → { projected, actual, isOut }. Also build a serializable
  // object form for passing to client components.
  const pointsByPlayerId: Record<number, { projected: number | null; actual: number | null; isOut: boolean }> = {};
  const weekPointsByPlayer = new Map<number, { projected: number | null; actual: number | null; isOut: boolean }>();
  for (const pid of playerIds) {
    const seasonProj = points.projectionFor(pid, 3);
    const actual = points.pointsAt(pid, nextTournamentId);
    const isOut =
      registeredSet != null
      && !registeredSet.has(pid)
      && actual == null;
    const entry = {
      projected: isOut ? 0 : seasonProj,
      actual: actual != null ? Math.round(actual * 10) / 10 : null,
      isOut,
    };
    weekPointsByPlayer.set(pid, entry);
    pointsByPlayerId[pid] = entry;
  }

  function buildSlotArray(starters: any[], numSlots: number): (any | null)[] {
    const result: (any | null)[] = new Array(numSlots).fill(null);
    const unordered: any[] = [];
    for (const s of starters) {
      const o = (s as any).lineup_order;
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

  const allMpoStarters = roster.filter((r) => r.is_starter && (r.players as any)?.division === "MPO");
  const allFpoStarters = roster.filter((r) => r.is_starter && (r.players as any)?.division === "FPO");

  const mpoSlotArray = buildSlotArray(allMpoStarters, mpoSlots);
  const fpoSlotArray = buildSlotArray(allFpoStarters, fpoSlots);

  const starterIds = new Set([...mpoSlotArray, ...fpoSlotArray].filter(Boolean).map((r: any) => r.id));
  // Bench order: MPO above FPO, then projected points (best first) within each
  // division; no-projection players sink to the bottom of their division.
  const benchProj = (r: any) => weekPointsByPlayer.get(r.player_id)?.projected ?? -1;
  const bench = roster
    .filter((r) => !starterIds.has(r.id))
    .sort((a: any, b: any) => {
      const aFpo = (a.players as any)?.division === "FPO" ? 1 : 0;
      const bFpo = (b.players as any)?.division === "FPO" ? 1 : 0;
      if (aFpo !== bFpo) return aFpo - bFpo;
      return benchProj(b) - benchProj(a);
    });

  const mpoBench = bench.filter((r) => (r.players as any)?.division === "MPO");
  const fpoBench = bench.filter((r) => (r.players as any)?.division === "FPO");

  function otherSlotsFor(slotArray: any[], skipIdx: number) {
    return slotArray
      .map((spot: any, i: number) => ({ spot: spot as any | null, slotIndex: i + 1 }))
      .filter(({ slotIndex: si }) => si !== skipIdx + 1);
  }

  const overRoster = roster.length > league.roster_size;
  const toDrop = roster.length - league.roster_size;
  const lineupsDisabled = overRoster || lineupLocked;

  // Compute the team's current W-L for the header.
  const { data: allMatchups } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score, is_final")
    .eq("league_id", id)
    .eq("is_final", true);
  let myWins = 0;
  let myLosses = 0;
  if (scoringMode === "head_to_head") {
    (allMatchups ?? []).forEach((m: any) => {
      if (m.team1_id === myMember.id) {
        if (m.team1_score > m.team2_score) myWins++;
        else if (m.team2_score > m.team1_score) myLosses++;
      } else if (m.team2_id === myMember.id) {
        if (m.team2_score > m.team1_score) myWins++;
        else if (m.team1_score > m.team2_score) myLosses++;
      }
    });
  } else {
    const weekly = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weekly, scoringMode);
    const rec = alt.get(myMember.id);
    if (rec) {
      myWins = rec.wins;
      myLosses = rec.losses;
    }
  }

  // ── Past week: the recorded (or reconstructed) lineup, read-only ────────────
  type HistoryRow = {
    playerId: number;
    name: string;
    division: "MPO" | "FPO";
    avatarUrl: string | null;
    actual: number | null;
  };
  let historyStarters: HistoryRow[] = [];
  let historyBench: HistoryRow[] = [];
  let historyIsSnapshot = false;
  if (mode === "past") {
    const snapshot = await getLineupSnapshot(supabase, Number(id), myMember.id, selectedWeek);
    // Past-week actuals under the league's rules, so a historical lineup adds
    // up to the same total the matchup page shows for that week.
    const weekActualFor = async (ids: number[]) => {
      const m = new Map<number, number>();
      if (weekTid == null || ids.length === 0) return m;
      const weekPoints = await loadPlayerPoints(supabase, {
        rules: (league as any).scoring_rules,
        playerIds: ids,
        tournamentIds: [weekTid],
      });
      for (const pid of ids) {
        const pts = weekPoints.pointsAt(pid, weekTid);
        if (pts != null) m.set(pid, pts);
      }
      return m;
    };
    if (snapshot) {
      historyIsSnapshot = true;
      const ids = [...snapshot.starters.map((s) => s.player_id), ...snapshot.bench];
      const { data: pRows } = ids.length > 0
        ? await supabase.from("players").select("id, name, division, avatar_url").in("id", ids)
        : { data: [] };
      const pById = new Map<number, any>((pRows ?? []).map((p: any) => [p.id, p]));
      const actuals = await weekActualFor(ids);
      const toRow = (pid: number): HistoryRow => ({
        playerId: pid,
        name: pById.get(pid)?.name ?? "Unknown",
        division: (pById.get(pid)?.division as "MPO" | "FPO") ?? "MPO",
        avatarUrl: pById.get(pid)?.avatar_url ?? null,
        actual: actuals.has(pid) ? Math.round(actuals.get(pid)! * 10) / 10 : null,
      });
      const ordered = [...snapshot.starters].sort((a, b) =>
        a.slot === b.slot ? a.order - b.order : a.slot === "MPO" ? -1 : 1,
      );
      historyStarters = ordered.map((s) => toRow(s.player_id));
      historyBench = snapshot.bench.map(toRow);
    } else {
      // No snapshot recorded (week finalized before this feature) — show the
      // current lineup with that week's actual points, like the matchup pages.
      const actuals = await weekActualFor(playerIds);
      const toRow = (r: any): HistoryRow => ({
        playerId: r.player_id,
        name: (r.players as any)?.name ?? "Unknown",
        division: ((r.players as any)?.division as "MPO" | "FPO") ?? "MPO",
        avatarUrl: (r.players as any)?.avatar_url ?? null,
        actual: actuals.has(r.player_id) ? Math.round(actuals.get(r.player_id)! * 10) / 10 : null,
      });
      historyStarters = [...mpoSlotArray, ...fpoSlotArray].filter(Boolean).map(toRow);
      historyBench = bench.map(toRow);
    }
  }

  // ── Future week: staged plan (falls back to the live lineup) ────────────────
  let planStarters: PlannedStarter[] = [];
  let planSavable = false;
  if (mode === "future") {
    planSavable = await lineupPlansAvailable(supabase);
    const plan = await getLineupPlan(supabase, Number(id), myMember.id, selectedWeek);
    if (plan && plan.length > 0) {
      planStarters = plan;
    } else {
      const derived: PlannedStarter[] = [];
      mpoSlotArray.forEach((spot: any, i: number) => {
        if (spot) derived.push({ player_id: spot.player_id, slot: "MPO", order: i + 1 });
      });
      fpoSlotArray.forEach((spot: any, i: number) => {
        if (spot) derived.push({ player_id: spot.player_id, slot: "FPO", order: i + 1 });
      });
      planStarters = derived;
    }
  }
  const editorPlayers: EditorPlayer[] = roster.map((r: any) => ({
    playerId: r.player_id,
    name: (r.players as any)?.name ?? "Unknown",
    division: ((r.players as any)?.division as "MPO" | "FPO") ?? "MPO",
    avatarUrl: (r.players as any)?.avatar_url ?? null,
    nickname: r.nickname ?? null,
    points: weekPointsByPlayer.get(r.player_id) ?? null,
  }));

  // Fetch transaction history
  const { data: txRows } = await supabase
    .from("roster_transactions")
    .select("id, action, created_at, players!roster_transactions_player_id_fkey(name, division), dropped:players!roster_transactions_dropped_player_id_fkey(name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const rosterTxs = (txRows ?? []).map((t: any) => ({
    id: t.id,
    action: t.action as "add" | "drop",
    createdAt: t.created_at,
    playerName: t.players?.name ?? "Unknown",
    playerDivision: t.players?.division ?? "MPO",
    droppedName: t.dropped?.name ?? null,
    droppedDivision: t.dropped?.division ?? null,
  }));

  // Fetch completed trades involving this team
  const { data: tradeRows } = await supabase
    .from("trades")
    .select(`
      id, status, resolved_at, message,
      proposer:league_members!trades_proposer_id_fkey(id, team_name),
      receiver:league_members!trades_receiver_id_fkey(id, team_name),
      trade_players(player_id, from_team_id, to_team_id, players(name))
    `)
    .eq("league_id", id)
    .in("status", ["accepted", "rejected"])
    .or(`proposer_id.eq.${myMember.id},receiver_id.eq.${myMember.id}`)
    .order("resolved_at", { ascending: false })
    .limit(20);

  const completedTrades = (tradeRows ?? []).map((t: any) => {
    const proposer = t.proposer;
    const receiver = t.receiver;
    const otherTeam = proposer?.id === myMember.id ? receiver?.team_name : proposer?.team_name;
    const received = (t.trade_players ?? [])
      .filter((tp: any) => tp.to_team_id === myMember.id)
      .map((tp: any) => tp.players?.name ?? "");
    const gave = (t.trade_players ?? [])
      .filter((tp: any) => tp.from_team_id === myMember.id)
      .map((tp: any) => tp.players?.name ?? "");
    return {
      id: t.id,
      status: t.status as "accepted" | "rejected",
      resolvedAt: t.resolved_at ?? "",
      otherTeam: otherTeam ?? "Unknown",
      received,
      gave,
    };
  });

  // This team's pending waiver claims (shown + reorderable in the panel).
  const { data: claimRows } = await supabase
    .from("waiver_claims")
    .select("id, player_id, drop_player_id, claim_order, submitted_at")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .eq("status", "pending")
    .order("claim_order", { ascending: true, nullsFirst: false })
    .order("submitted_at", { ascending: true });
  const claimPlayerIds = [
    ...new Set((claimRows ?? []).flatMap((c: any) => [c.player_id, c.drop_player_id]).filter(Boolean)),
  ] as number[];
  const { data: claimPlayers } = claimPlayerIds.length > 0
    ? await supabase.from("players").select("id, name, division").in("id", claimPlayerIds)
    : { data: [] };
  const claimPmap = new Map<number, any>((claimPlayers ?? []).map((p: any) => [p.id, p]));
  const pendingWaiverClaims = (claimRows ?? []).map((c: any) => ({
    id: c.id as number,
    addName: claimPmap.get(c.player_id)?.name ?? "Unknown",
    addDivision: claimPmap.get(c.player_id)?.division ?? "MPO",
    dropName: c.drop_player_id ? (claimPmap.get(c.drop_player_id)?.name ?? null) : null,
    dropDivision: c.drop_player_id ? (claimPmap.get(c.drop_player_id)?.division ?? null) : null,
  }));

  const historySlotLabels = (() => {
    const labels: string[] = [];
    if (historyIsSnapshot) {
      let m = 0;
      let f = 0;
      for (const r of historyStarters) labels.push(r.division === "FPO" ? `FPO${++f}` : `MPO${++m}`);
    } else {
      historyStarters.forEach((r, i) => labels.push(`${r.division}${i + 1}`));
    }
    return labels;
  })();

  const historyRow = (r: HistoryRow, label: string | null, starter: boolean) => (
    <div
      key={`${label ?? "bn"}-${r.playerId}`}
      className={`flex items-center gap-3 p-3 rounded-xl border ${
        starter ? "" : "bg-[#0f1117] border-white/5"
      }`}
      style={
        starter
          ? {
              background: r.division === "MPO" ? "var(--mpo-fill)" : "var(--fpo-fill)",
              borderColor: r.division === "MPO" ? "var(--mpo-fill-border)" : "var(--fpo-fill-border)",
            }
          : undefined
      }
    >
      <span
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{
          color: r.division === "MPO" ? "#4B3DFF" : "#36D7B7",
          background: `${r.division === "MPO" ? "#4B3DFF" : "#36D7B7"}20`,
        }}
      >
        {r.division}
      </span>
      <PlayerPhoto player={{ name: r.name, avatar_url: r.avatarUrl }} />
      <div className="flex-1 min-w-0">
        <Link
          href={`/league/${id}/player/${r.playerId}`}
          className="block text-white text-sm font-medium truncate hover:underline"
        >
          {r.name}
        </Link>
      </div>
      <WeekPointsBadge wp={{ projected: null, actual: r.actual ?? 0, isOut: false }} />
    </div>
  );

  return (
    <div className="max-w-2xl space-y-4">
      {weekTabs.length > 0 && (
        <WeekSwitcher
          basePath={`/league/${id}/lineups`}
          weeks={weekTabs}
          selected={selectedWeek}
          currentWeek={currentWeek}
        />
      )}

      {mode === "current" && pollableTournament && (
        <LiveScoreRefresher tournamentName={pollableTournament.name} />
      )}

      {mode === "current" && (() => {
        // Sleeper-style lineup alert: starters who are OUT for this week's
        // event (not registered, no score yet) or unfilled starter slots.
        const starterSpots = [...mpoSlotArray, ...fpoSlotArray];
        const emptyCount = starterSpots.filter((s) => !s).length;
        const outNames = starterSpots
          .filter(Boolean)
          .filter((s: any) => weekPointsByPlayer.get(s.player_id)?.isOut)
          .map((s: any) => (s.players as any)?.name ?? "Unknown");
        if (emptyCount === 0 && outNames.length === 0) return null;
        const eventName = weekTabs.find((t) => t.week === selectedWeek)?.eventName ?? null;
        return (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
            <div className="min-w-0 flex-1">
              <p className="text-red-400 font-semibold text-sm">
                {outNames.length > 0
                  ? `${outNames.length} starter${outNames.length !== 1 ? "s" : ""} OUT${eventName ? ` for ${eventName}` : " this week"}`
                  : `${emptyCount} empty lineup slot${emptyCount !== 1 ? "s" : ""}`}
              </p>
              <p className="text-red-300/80 text-xs mt-0.5">
                {outNames.length > 0 && outNames.join(", ")}
                {outNames.length > 0 && emptyCount > 0 && " · "}
                {emptyCount > 0 && `${emptyCount} empty slot${emptyCount !== 1 ? "s" : ""}`}
                {lineupsDisabled
                  ? " — lineup is locked, but you can still set future weeks above."
                  : " — swap them out below before lock."}
              </p>
            </div>
            {!lineupsDisabled && (
              <form action={optimizeLineup.bind(null, Number(id))} className="shrink-0 self-center">
                <button
                  type="submit"
                  className="bg-red-500/90 hover:bg-red-500 text-white text-xs font-bold px-3.5 py-2 rounded-full transition"
                  title="Start your highest-projected eligible players"
                >
                  Optimize
                </button>
              </form>
            )}
          </div>
        );
      })()}

      {mode === "current" && overRoster && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-red-400 font-semibold text-sm">Roster over limit</p>
            <p className="text-red-300/80 text-xs mt-0.5">
              You have {roster.length} players but the max is {league.roster_size}.
              Drop {toDrop} player{toDrop !== 1 ? "s" : ""} to unlock lineup changes.
            </p>
          </div>
        </div>
      )}

      {mode === "current" && lineupLocked && activeTournament && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-yellow-400 text-lg leading-none mt-0.5">🔒</span>
          <div>
            <p className="text-yellow-300 font-semibold text-sm">Lineup locked — {activeTournament.name} is in progress</p>
            <p className="text-yellow-300/70 text-xs mt-0.5">
              {/* end_date is a bare "YYYY-MM-DD"; append a time so it renders as
                  the same calendar date regardless of server timezone (a plain
                  `new Date("YYYY-MM-DD")` would parse as UTC midnight). */}
              Lineup changes reopen after {new Date(activeTournament.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
              You can still set future weeks&apos; lineups from the week strip above.
            </p>
          </div>
        </div>
      )}

      {mode === "current" && (
        <TeamActionsPanel
          leagueId={Number(id)}
          myTeamId={myMember.id}
          rosterTxs={rosterTxs}
          completedTrades={completedTrades}
          pendingClaims={pendingWaiverClaims}
        />
      )}

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-white text-lg">{myMember.team_name}</h2>
            {mode !== "current" && (
              <p className="text-gray-400 text-xs mt-0.5">
                {mode === "past"
                  ? `Week ${selectedWeek} lineup${historyIsSnapshot ? "" : " (current roster shown)"}`
                  : `Planning week ${selectedWeek} — applies when the week starts`}
              </p>
            )}
          </div>
          {(() => {
            let projTotal = 0;
            let actualTotal = 0;
            let anyActual = false;
            if (mode === "past") {
              for (const r of historyStarters) {
                if (r.actual != null) { actualTotal += r.actual; anyActual = true; }
              }
            } else if (mode === "future") {
              const started = new Set(planStarters.map((s) => s.player_id));
              for (const pid of started) {
                const wp = weekPointsByPlayer.get(pid);
                if (wp?.projected != null) projTotal += wp.projected;
              }
            } else {
              const starterSpots = [...mpoSlotArray, ...fpoSlotArray].filter(Boolean) as any[];
              for (const s of starterSpots) {
                const wp = weekPointsByPlayer.get(s.player_id);
                if (!wp) continue;
                if (wp.actual != null) { actualTotal += wp.actual; anyActual = true; }
                if (wp.projected != null) projTotal += wp.projected;
              }
            }
            const displayTotal = anyActual ? actualTotal : projTotal;
            return (
              <div className="text-right">
                <p className="text-white font-semibold text-sm tabular-nums">{myWins}-{myLosses}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {displayTotal.toFixed(1)} pts{" "}
                  {mode === "past" ? `in week ${selectedWeek}` : anyActual ? "this event" : "projected"}
                </p>
              </div>
            );
          })()}
        </div>

        {mode === "past" && (
          <>
            <div className="space-y-2 mb-6">
              {historyStarters.length > 0
                ? historyStarters.map((r, i) => historyRow(r, historySlotLabels[i] ?? null, true))
                : <p className="text-gray-400 text-sm italic">No lineup recorded for this week.</p>}
            </div>
            {historyBench.length > 0 && (
              <>
                <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Bench</h3>
                <div className="space-y-2">
                  {historyBench.map((r) => historyRow(r, null, false))}
                </div>
              </>
            )}
          </>
        )}

        {mode === "future" && (
          <WeekLineupEditor
            leagueId={Number(id)}
            week={selectedWeek}
            mpoSlots={mpoSlots}
            fpoSlots={fpoSlots}
            players={editorPlayers}
            initialStarters={planStarters}
            canSave={planSavable}
          />
        )}

        {mode === "current" && (
          <>
            <div className="space-y-2 mb-6">
              {mpoSlotArray.map((occupant: any, i: number) => (
                <LineupSlot
                  key={`mpo-${i}`}
                  leagueId={Number(id)}
                  division="MPO"
                  slotIndex={i + 1}
                  occupant={occupant}
                  benchPlayers={mpoBench as any}
                  otherStarters={otherSlotsFor(mpoSlotArray, i)}
                  locked={lineupsDisabled}
                  weekPoints={occupant ? weekPointsByPlayer.get(occupant.player_id) ?? null : null}
                  pointsByPlayerId={pointsByPlayerId}
                />
              ))}
              {fpoSlotArray.map((occupant: any, i: number) => (
                <LineupSlot
                  key={`fpo-${i}`}
                  leagueId={Number(id)}
                  division="FPO"
                  slotIndex={i + 1}
                  occupant={occupant}
                  benchPlayers={fpoBench as any}
                  otherStarters={otherSlotsFor(fpoSlotArray, i)}
                  locked={lineupsDisabled}
                  weekPoints={occupant ? weekPointsByPlayer.get(occupant.player_id) ?? null : null}
                  pointsByPlayerId={pointsByPlayerId}
                />
              ))}
            </div>

            {bench.length > 0 && (
              <>
                <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Bench</h3>
                <div className="space-y-2">
                  {bench.map((spot) => {
                    const div = (spot.players as any)?.division ?? "MPO";
                    return (
                      <BenchSlot
                        key={spot.id}
                        leagueId={Number(id)}
                        benchSpot={spot as any}
                        starterSlots={div === "MPO" ? mpoSlotArray : fpoSlotArray}
                        locked={lineupsDisabled}
                        weekPoints={weekPointsByPlayer.get(spot.player_id) ?? null}
                        pointsByPlayerId={pointsByPlayerId}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {roster.length === 0 && mode !== "past" && (
          <p className="text-gray-400 text-sm text-center py-4">
            No players on your roster yet. Add players in Free Agency.
          </p>
        )}
      </div>
    </div>
  );
}
