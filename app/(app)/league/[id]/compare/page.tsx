import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PlayerPickerMulti } from "@/components/player-picker-multi";
import {
  TournamentRangePicker,
  type TournamentOpt,
} from "@/components/tournament-range-picker";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ players?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!league) notFound();
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const selectedIds = (sp.players ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division")
    .order("name");
  const allOpts = (allPlayers ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    division: (p.division ?? "MPO") as "MPO" | "FPO",
  }));

  // All scheduled tournaments — used for the range picker UI.
  const { data: allTournaments } = await supabase
    .from("tournaments")
    .select("id, name, start_date")
    .order("start_date", { ascending: true });
  const tournamentOpts: TournamentOpt[] = (allTournaments ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    startDate: t.start_date ?? "",
  }));

  // Resolve the from/to filter against the start_date of each tournament so
  // they can be applied as a date range in the query.
  const fromId = sp.from ? Number(sp.from) : null;
  const toId = sp.to ? Number(sp.to) : null;
  const fromTournament = fromId != null ? tournamentOpts.find((t) => t.id === fromId) : null;
  const toTournament = toId != null ? tournamentOpts.find((t) => t.id === toId) : null;
  // Normalize order so picking a later "from" than "to" still works.
  let rangeStart = fromTournament?.startDate ?? null;
  let rangeEnd = toTournament?.startDate ?? null;
  if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
    [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
  }

  // For chosen players, pull all results joined with the tournament. We apply
  // the date range against tournaments.start_date when set.
  const players = allOpts.filter((p) => selectedIds.includes(p.id));
  let resultsQuery = supabase
    .from("tournament_results")
    .select("player_id, tournament_id, finishing_position, fantasy_points, tournaments!inner(name, start_date, week)")
    .in("player_id", selectedIds);
  if (rangeStart) {
    resultsQuery = resultsQuery.gte("tournaments.start_date", rangeStart);
  }
  if (rangeEnd) {
    resultsQuery = resultsQuery.lte("tournaments.start_date", rangeEnd);
  }
  const { data: results } = selectedIds.length > 0
    ? await resultsQuery
    : { data: [] };

  // Build per-tournament rows: { tournamentId, name, startDate, week, byPlayer: Map<playerId, {finish, pts}> }
  const tournaments = new Map<number, { id: number; name: string; startDate: string; week: number }>();
  const byTournament = new Map<number, Map<number, { finish: number; pts: number }>>();
  (results ?? []).forEach((r: any) => {
    const tid = r.tournament_id as number;
    const tName = r.tournaments?.name ?? "Tournament";
    const tStart = r.tournaments?.start_date ?? "";
    const tWeek = r.tournaments?.week ?? 0;
    tournaments.set(tid, { id: tid, name: tName, startDate: tStart, week: tWeek });
    if (!byTournament.has(tid)) byTournament.set(tid, new Map());
    byTournament.get(tid)!.set(r.player_id, {
      finish: Number(r.finishing_position ?? 0),
      pts: Number(r.fantasy_points ?? 0),
    });
  });
  const sortedTournaments = Array.from(tournaments.values()).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  // Totals per player (over the filtered range).
  const totals = new Map<number, { pts: number; events: number; finishSum: number; bestFinish: number; wins: number }>();
  for (const p of players) totals.set(p.id, { pts: 0, events: 0, finishSum: 0, bestFinish: 99, wins: 0 });
  (results ?? []).forEach((r: any) => {
    const t = totals.get(r.player_id);
    if (!t) return;
    const pts = Number(r.fantasy_points ?? 0);
    const fin = Number(r.finishing_position ?? 99);
    t.pts += pts;
    t.events += 1;
    t.finishSum += fin;
    if (fin > 0 && fin < t.bestFinish) t.bestFinish = fin;
    if (fin === 1) t.wins += 1;
  });

  const rangeLabel = describeRange(fromTournament, toTournament);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/league/${id}`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← League
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-white font-bold text-xl">Player Comparison</h2>
          <PlayerPickerMulti players={allOpts} selectedIds={selectedIds} />
        </div>
        <p className="text-gray-400 text-sm mt-1">
          Pick two or more players to compare season totals and per-event head-to-head.
        </p>
      </div>

      {tournamentOpts.length > 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-4 border border-white/5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="text-white font-semibold text-sm">Tournament range</h3>
            <span className="text-gray-400 text-xs">{rangeLabel}</span>
          </div>
          <TournamentRangePicker
            tournaments={tournamentOpts}
            selectedFrom={fromId}
            selectedTo={toId}
          />
        </div>
      )}

      {players.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">No players selected yet.</p>
        </div>
      ) : (
        <>
          {/* Season totals */}
          <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-[10px] uppercase tracking-wider">
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-2">Player</th>
                  <th className="text-right px-4 py-2">Events</th>
                  <th className="text-right px-4 py-2">Total Pts</th>
                  <th className="text-right px-4 py-2">Avg Finish</th>
                  <th className="text-right px-4 py-2">Best</th>
                  <th className="text-right px-4 py-2">Wins</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const t = totals.get(p.id)!;
                  const accent = p.division === "MPO" ? "#4B3DFF" : "#36D7B7";
                  const avg = t.events > 0 ? Math.round(t.finishSum / t.events) : null;
                  return (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: accent, background: `${accent}20` }}
                          >
                            {p.division}
                          </span>
                          <Link
                            href={`/league/${id}/player/${p.id}`}
                            className="text-white font-medium truncate hover:underline"
                          >
                            {p.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-white tabular-nums">{t.events}</td>
                      <td className="px-4 py-2.5 text-right text-white tabular-nums font-semibold">{t.pts.toFixed(1)}</td>
                      <td className="px-4 py-2.5 text-right text-white tabular-nums">{avg ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right text-white tabular-nums">{t.bestFinish < 99 ? `#${t.bestFinish}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-white tabular-nums">{t.wins}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-event head-to-head */}
          {sortedTournaments.length > 0 && (
            <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5">
                <h3 className="text-white font-bold">Per-event head-to-head</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-[10px] uppercase tracking-wider bg-[#0f1117]">
                    <tr>
                      <th className="text-left px-4 py-2">Event</th>
                      {players.map((p) => (
                        <th key={p.id} className="text-right px-4 py-2 whitespace-nowrap">
                          {p.name.split(" ").slice(-1)[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTournaments.map((t) => {
                      // Determine winner of this event among selected players.
                      const ptsByPlayer = players.map((p) => ({
                        id: p.id,
                        pts: byTournament.get(t.id)?.get(p.id)?.pts ?? null,
                      }));
                      const playedPts = ptsByPlayer.filter((x) => x.pts != null).map((x) => x.pts!) as number[];
                      const max = playedPts.length > 0 ? Math.max(...playedPts) : null;
                      return (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="px-4 py-2.5 text-white text-sm">
                            <p className="font-medium truncate">{t.name}</p>
                            <p className="text-gray-400 text-xs">
                              {t.startDate &&
                                new Date(t.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                          </td>
                          {players.map((p) => {
                            const r = byTournament.get(t.id)?.get(p.id);
                            const isBest = max != null && r?.pts === max && playedPts.length > 1;
                            return (
                              <td key={p.id} className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                                {r ? (
                                  <div>
                                    <p className={`text-sm font-semibold ${isBest ? "text-[#36D7B7]" : "text-white"}`}>
                                      {r.pts.toFixed(1)}
                                    </p>
                                    <p className="text-gray-400 text-[10px]">#{r.finish}</p>
                                  </div>
                                ) : (
                                  <span className="text-gray-500">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function describeRange(
  from: TournamentOpt | null | undefined,
  to: TournamentOpt | null | undefined,
): string {
  if (!from && !to) return "All tournaments";
  if (from && to) {
    if (from.id === to.id) return `Just ${from.name}`;
    const [a, b] = (from.startDate ?? "") <= (to.startDate ?? "") ? [from, to] : [to, from];
    return `${a.name} → ${b.name}`;
  }
  if (from) return `From ${from.name}`;
  return `Through ${to!.name}`;
}
