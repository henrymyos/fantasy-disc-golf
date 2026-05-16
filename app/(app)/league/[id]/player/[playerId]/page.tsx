import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { AddWithDropModal } from "@/components/add-with-drop-modal";
import { placeWaiverClaim } from "@/actions/rosters";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string; playerId: string }>;
}) {
  const { id, playerId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const { data: player } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank")
    .eq("id", playerId)
    .single();
  if (!player) notFound();

  // Player's current roster status in this league.
  const { data: rosterEntry } = await supabase
    .from("rosters")
    .select("team_id, league_members!inner(id, team_name)")
    .eq("league_id", id)
    .eq("player_id", playerId)
    .maybeSingle();
  const ownerTeamId = (rosterEntry as any)?.team_id ?? null;
  const ownerTeamName = (rosterEntry as any)?.league_members?.team_name ?? null;
  const isFreeAgent = ownerTeamId == null;
  const isMine = ownerTeamId === member.id;

  // For an Add/Claim button we need league info, draft status, waiver state,
  // and the user's current roster.
  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size, waivers_locked")
    .eq("id", id)
    .single();
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", id)
    .single();
  const draftComplete = draft?.status === "complete";

  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: activeTournament } = await supabase
    .from("tournaments")
    .select("id")
    .lte("start_date", todayIso)
    .gte("end_date", todayIso)
    .maybeSingle();
  const waiversActive = ((league as any)?.waivers_locked === true) || activeTournament !== null;

  const { data: myRosterRows } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", member.id);
  const myRoster = myRosterRows ?? [];
  const rosterCount = myRoster.length;
  const openSpots = Math.max(0, ((league as any)?.roster_size ?? 14) - rosterCount);

  const { data: myClaim } = await supabase
    .from("waiver_claims")
    .select("id")
    .eq("league_id", id)
    .eq("team_id", member.id)
    .eq("player_id", playerId)
    .eq("status", "pending")
    .maybeSingle();
  const hasPendingClaim = myClaim !== null;

  const { data: events } = await supabase
    .from("tournaments")
    .select(`
      id, name, week, start_date, pdga_event_id,
      tournament_results(fantasy_points, finishing_position, hot_round_count, bogey_free_count, ace_count)
    `)
    .eq("tournament_results.player_id", playerId)
    .order("start_date", { ascending: true });

  // All result rows for players in this player's division — used both to
  // compute event-level field sizes and to tier this player's season totals
  // and average finish against same-division peers.
  const { data: divResults } = await supabase
    .from("tournament_results")
    .select("tournament_id, player_id, finishing_position, fantasy_points, players!inner(division)")
    .eq("players.division", player.division);

  const fieldSizeByTournament = new Map<number, number>();
  const peerTotals = new Map<number, number>();
  const peerFinishes = new Map<number, number[]>();
  (divResults ?? []).forEach((r: any) => {
    fieldSizeByTournament.set(r.tournament_id, (fieldSizeByTournament.get(r.tournament_id) ?? 0) + 1);
    peerTotals.set(r.player_id, (peerTotals.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0));
    const arr = peerFinishes.get(r.player_id) ?? [];
    arr.push(Number(r.finishing_position));
    peerFinishes.set(r.player_id, arr);
  });

  const GREEN = "#4ade80";
  const YELLOW = "#facc15";
  const RED = "#f87171";

  const isMpo = player.division === "MPO";
  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

  function tierColor(finish: number | null, tournamentId: number): string {
    if (finish == null) return accentColor;
    const size = fieldSizeByTournament.get(tournamentId);
    if (!size || size < 4) return accentColor;
    const ratio = finish / size;
    if (ratio <= 0.25) return GREEN;
    if (ratio <= 0.5) return YELLOW;
    return RED;
  }

  // Build percentile thresholds among peers (same division, at least one result).
  function thresholds(values: number[], lowerIsBetter: boolean): { top25: number; top50: number } | null {
    if (values.length < 4) return null;
    const sorted = [...values].sort((a, b) => (lowerIsBetter ? a - b : b - a));
    const top25Idx = Math.max(0, Math.ceil(sorted.length * 0.25) - 1);
    const top50Idx = Math.max(0, Math.ceil(sorted.length * 0.5) - 1);
    return { top25: sorted[top25Idx], top50: sorted[top50Idx] };
  }

  const peerTotalArr = [...peerTotals.values()];
  const peerAvgArr = [...peerFinishes.entries()]
    .map(([, arr]) => arr.reduce((s, n) => s + n, 0) / arr.length);
  const totalThresh = thresholds(peerTotalArr, false);
  const avgThresh = thresholds(peerAvgArr, true);

  function totalPtsColor(value: number): string {
    if (!totalThresh) return "white";
    if (value >= totalThresh.top25) return GREEN;
    if (value >= totalThresh.top50) return YELLOW;
    return RED;
  }
  function avgFinishColor(value: number): string {
    if (!avgThresh) return "white";
    if (value <= avgThresh.top25) return GREEN;
    if (value <= avgThresh.top50) return YELLOW;
    return RED;
  }

  const playedEvents = (events ?? []).filter((e) => ((e.tournament_results as any[]) ?? []).length > 0);

  const totalPts = playedEvents.reduce((sum, e) => {
    const r = (e.tournament_results as any)[0];
    return sum + (r?.fantasy_points ?? 0);
  }, 0);

  const avgFinish = playedEvents.length > 0
    ? Math.round(
        playedEvents.reduce((sum, e) => {
          const r = (e.tournament_results as any)[0];
          return sum + (r?.finishing_position ?? 0);
        }, 0) / playedEvents.length
      )
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Back + header */}
      <div>
        <BackLink fallbackHref={`/league/${id}/lineups`} />

        {/* Action chip: Trade / Add / Claim / Pending / Mine */}
        {!isMine && (
          <div className="mb-4">
            {isFreeAgent ? (
              !draftComplete ? (
                <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                  Add locked until draft completes
                </span>
              ) : waiversActive ? (
                hasPendingClaim ? (
                  <span className="text-xs border border-yellow-400/40 text-yellow-300 px-3 py-1.5 rounded-full font-medium">
                    Claim pending
                  </span>
                ) : (
                  <form action={placeWaiverClaim.bind(null, Number(id), Number(playerId), undefined)}>
                    <button
                      type="submit"
                      className="text-xs bg-yellow-400 hover:bg-yellow-300 text-black font-bold px-4 py-1.5 rounded-full transition"
                    >
                      Claim
                    </button>
                  </form>
                )
              ) : (
                <AddWithDropModal
                  leagueId={Number(id)}
                  addPlayer={{ id: player.id, name: player.name, division: player.division }}
                  myRoster={myRoster as any}
                  openSpots={openSpots}
                />
              )
            ) : (
              <Link
                href={`/league/${id}/trades?with=${ownerTeamId}&want=${playerId}`}
                className="inline-flex items-center text-xs bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-4 py-1.5 rounded-full transition"
                title={ownerTeamName ? `Trade with ${ownerTeamName}` : "Propose a trade"}
              >
                Trade
              </Link>
            )}
          </div>
        )}

        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0"
            style={{ background: `${accentColor}25`, border: `1.5px solid ${accentColor}40` }}
          >
            {player.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-bold text-xl truncate">{player.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-xs font-bold uppercase px-2 py-0.5 rounded"
                style={{ color: accentColor, background: `${accentColor}20` }}
              >
                {player.division}
              </span>
              {player.world_ranking && (
                <span className="text-gray-500 text-xs">#{player.world_ranking} world ranking</span>
              )}
            </div>
          </div>
          {playedEvents.length > 0 && (
            <div className="ml-auto flex gap-5 shrink-0">
              <div className="text-center">
                <p className="font-bold text-lg" style={{ color: totalPtsColor(totalPts) }}>{totalPts.toFixed(1)}</p>
                <p className="text-gray-500 text-xs">Total pts</p>
              </div>
              {avgFinish && (
                <div className="text-center">
                  <p className="font-bold text-lg" style={{ color: avgFinishColor(avgFinish) }}>{avgFinish}</p>
                  <p className="text-gray-500 text-xs">Avg finish</p>
                </div>
              )}
              <div className="text-center">
                <p className="text-white font-bold text-lg">{playedEvents.length}</p>
                <p className="text-gray-500 text-xs">Events</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Game log */}
      <div>
        <h2 className="text-white font-bold mb-3">Tournament Log</h2>
        {(events ?? []).length === 0 ? (
          <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
            <p className="text-gray-600 text-sm">No events played yet.</p>
          </div>
        ) : (
          <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2 border-b border-white/5">
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide">Event</span>
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-right w-14">Pts</span>
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-right w-12">Finish</span>
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-center w-8">🔥</span>
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-center w-8">✅</span>
              <span className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-center w-8">🎯</span>
            </div>

            {(events ?? []).map((event, i) => {
              const r = (event.tournament_results as any)[0];
              const pts: number = r?.fantasy_points ?? 0;
              const finish: number | null = r?.finishing_position ?? null;
              const hot: number = r?.hot_round_count ?? 0;
              const clean: number = r?.bogey_free_count ?? 0;
              const aces: number = r?.ace_count ?? 0;

              return (
                <div
                  key={event.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-3 items-center ${
                    i !== 0 ? "border-t border-white/5" : ""
                  }`}
                >
                  <div className="min-w-0">
                    {(event as any).pdga_event_id ? (
                      <a
                        href={`https://www.pdga.com/tour/event/${(event as any).pdga_event_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white text-sm font-medium truncate hover:underline block"
                      >
                        {event.name}
                      </a>
                    ) : (
                      <p className="text-white text-sm font-medium truncate">{event.name}</p>
                    )}
                    {event.start_date && (
                      <p className="text-gray-600 text-xs mt-0.5">
                        {new Date(event.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums text-right w-14"
                    style={{ color: tierColor(finish, event.id) }}
                  >
                    {pts > 0 ? pts.toFixed(1) : "—"}
                  </span>
                  <span className="text-white text-sm tabular-nums text-right w-12">
                    {finish != null ? `#${finish}` : "—"}
                  </span>
                  <span className="text-sm tabular-nums text-center w-8">
                    {hot > 0 ? <span className="text-white font-medium">{hot}</span> : <span className="text-gray-700">—</span>}
                  </span>
                  <span className="text-sm tabular-nums text-center w-8">
                    {clean > 0 ? <span className="text-white font-medium">{clean}</span> : <span className="text-gray-700">—</span>}
                  </span>
                  <span className="text-sm tabular-nums text-center w-8">
                    {aces > 0 ? <span className="text-white font-medium">{aces}</span> : <span className="text-gray-700">—</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
