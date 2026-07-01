import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FreeAgencyList } from "@/components/free-agency-list";
import { setWaiversLocked, processWaivers } from "@/actions/rosters";
import { applyProjectionVariance } from "@/lib/projections";
import { getActiveTournament } from "@/lib/lineup-lock";

export default async function FreeAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size, waivers_locked, commissioner_id, selected_event_slugs")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const isCommissioner = (league as any).commissioner_id === user.id;

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name, waiver_priority")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard");

  const { data: allMembers } = await supabase
    .from("league_members")
    .select("id, team_name, waiver_priority")
    .eq("league_id", id)
    .order("waiver_priority", { ascending: true, nullsFirst: false });
  const waiverOrder = (allMembers ?? []) as Array<{
    id: number;
    team_name: string;
    waiver_priority: number | null;
  }>;

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", id)
    .single();

  const draftComplete = draft?.status === "complete";

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id, team_id, league_members!inner(team_name)")
    .eq("league_id", id);

  const rosteredOwner = new Map<number, { teamId: number; teamName: string }>();
  (rosteredSpots ?? []).forEach((r: any) => {
    rosteredOwner.set(r.player_id, {
      teamId: r.team_id,
      teamName: r.league_members?.team_name ?? "Unknown",
    });
  });
  const rosteredIds = new Set(rosteredOwner.keys());

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank, pdga_rating");

  const { data: resultRows } = await supabase
    .from("tournament_results")
    .select("player_id, fantasy_points, tournament_id");

  const pointsByPlayer = new Map<number, number>();
  const eventsPlayedByPlayer = new Map<number, number>();
  (resultRows ?? []).forEach((r: any) => {
    pointsByPlayer.set(
      r.player_id,
      (pointsByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0),
    );
    eventsPlayedByPlayer.set(r.player_id, (eventsPlayedByPlayer.get(r.player_id) ?? 0) + 1);
  });

  const seasonStarted = (resultRows ?? []).length > 0;

  // Total events in the league's selected season (fall back to whatever
  // tournaments exist in DB if no selection is stored).
  const selectedCount = ((league as any).selected_event_slugs?.length as number | undefined);
  const totalEventsInSeason = selectedCount ?? new Set((resultRows ?? []).map((r: any) => r.tournament_id)).size;

  function projectionFor(playerId: number): number | null {
    const total = pointsByPlayer.get(playerId) ?? 0;
    const played = eventsPlayedByPlayer.get(playerId) ?? 0;
    if (played === 0 || totalEventsInSeason === 0) return null;
    return applyProjectionVariance((total / played) * totalEventsInSeason, playerId);
  }

  // Per-event projection for the next/active tournament. Returns 0 when the
  // target tournament has a populated registration list and the player isn't
  // on it (OUT), null when we have no signal to project from.
  const activeT = await getActiveTournament(supabase);
  const todayIsoNext = new Date().toISOString().slice(0, 10);
  let nextTournamentId: number | null = activeT?.id ?? null;
  if (!nextTournamentId) {
    const { data: upcomingT } = await supabase
      .from("tournaments")
      .select("id")
      .gte("start_date", todayIsoNext)
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    nextTournamentId = (upcomingT as any)?.id ?? null;
  }
  let nextRegisteredSet: Set<number> | null = null;
  if (nextTournamentId != null) {
    const { data: regRow } = await supabase
      .from("tournaments")
      .select("registered_player_ids")
      .eq("id", nextTournamentId)
      .maybeSingle();
    const ids = (regRow as any)?.registered_player_ids as number[] | null;
    if (ids && ids.length > 0) nextRegisteredSet = new Set(ids);
  }

  function nextProjectionFor(playerId: number): number | null {
    if (nextRegisteredSet != null && !nextRegisteredSet.has(playerId)) return 0;
    const total = pointsByPlayer.get(playerId) ?? 0;
    const played = eventsPlayedByPlayer.get(playerId) ?? 0;
    if (played === 0) return null;
    return applyProjectionVariance(total / played, playerId, 3);
  }

  const freeAgents = (allPlayers ?? [])
    .filter((p) => !rosteredIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      division: p.division,
      worldRanking: p.world_ranking as number | null,
      overallRank: (p as any).overall_rank as number | null,
      pdgaRating: (p as any).pdga_rating as number | null,
      totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
      nextWeekPoints: nextProjectionFor(p.id),
    }));

  const leaderboard = (allPlayers ?? [])
    .map((p) => {
      const owner = rosteredOwner.get(p.id);
      return {
        id: p.id,
        name: p.name,
        division: p.division,
        worldRanking: p.world_ranking as number | null,
        overallRank: (p as any).overall_rank as number | null,
        pdgaRating: (p as any).pdga_rating as number | null,
        totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
        projectedPoints: projectionFor(p.id),
        nextWeekPoints: nextProjectionFor(p.id),
        ownerTeamId: owner?.teamId ?? null,
        ownerTeamName: owner?.teamName ?? null,
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("player_id");

  const rosterCount = (myRoster ?? []).length;
  const overLimit = rosterCount > league.roster_size;
  const openSpots = Math.max(0, league.roster_size - rosterCount);

  const { data: activeTournament } = await supabase
    .from("tournaments")
    .select("id, name, end_date")
    .lte("start_date", new Date().toISOString().slice(0, 10))
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  const waiversLocked = (league as any).waivers_locked === true || activeTournament !== null;

  const { data: myClaims } = await supabase
    .from("waiver_claims")
    .select("id, player_id, drop_player_id, submitted_at, players!waiver_claims_player_id_fkey(name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  const pendingClaims = (myClaims ?? []).map((c: any) => ({
    id: c.id,
    playerId: c.player_id,
    playerName: c.players?.name ?? "Unknown",
    division: c.players?.division ?? "MPO",
    dropPlayerId: c.drop_player_id,
  }));

  return (
    <div className="max-w-xl space-y-4">
      {!draftComplete && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-yellow-400 text-lg leading-none mt-0.5">🔒</span>
          <div className="flex-1">
            <p className="text-yellow-300 font-semibold text-sm">Free agency opens after the draft</p>
            <p className="text-yellow-300/70 text-xs mt-0.5">
              You can browse free agents, but adds are locked until the draft is complete.
            </p>
          </div>
          <Link
            href={`/league/${id}/draft`}
            className="text-yellow-300 hover:text-white text-xs font-semibold whitespace-nowrap shrink-0 self-center underline"
          >
            View draft →
          </Link>
        </div>
      )}

      {overLimit && draftComplete && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-red-400 font-semibold text-sm">Roster over limit</p>
            <p className="text-red-300/80 text-xs mt-0.5">
              You have {rosterCount} players but the max is {league.roster_size}.
              Drop {rosterCount - league.roster_size} player{rosterCount - league.roster_size !== 1 ? "s" : ""} before adding anyone new.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-bold">Players</h2>
        </div>
        {draftComplete && !overLimit && openSpots === 0 && (
          <span className="text-yellow-400 text-xs bg-yellow-400/10 px-3 py-1 rounded-full">
            Roster full — pick a player to drop when adding
          </span>
        )}
        {draftComplete && !overLimit && openSpots > 0 && (
          <span className="text-gray-400 text-xs bg-white/5 px-3 py-1 rounded-full">
            {openSpots} open spot{openSpots !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {waiversLocked && draftComplete && (
        <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-yellow-400 text-lg leading-none mt-0.5">🔒</span>
          <div>
            <p className="text-yellow-300 font-semibold text-sm">Waivers are running</p>
            <p className="text-yellow-300/70 text-xs mt-0.5">
              Free agency is paused. Place a claim and the commissioner will process them in priority order.
            </p>
          </div>
        </div>
      )}

      {draftComplete && waiversLocked && (
        <details className="bg-[#1a1d23] rounded-2xl border border-white/5 px-4 py-3 group">
          <summary className="cursor-pointer flex items-center justify-between gap-3 text-sm">
            <span className="text-white font-semibold">Waiver order</span>
            <span className="text-gray-400 text-xs">
              You're #{(myMember as any).waiver_priority ?? "—"} · waivers running
            </span>
          </summary>
          <ol className="mt-3 space-y-1 text-sm">
            {waiverOrder.map((m, i) => (
              <li
                key={m.id}
                className={`flex items-center gap-3 px-2 py-1.5 rounded ${
                  m.id === myMember.id ? "bg-[#4B3DFF]/10" : ""
                }`}
              >
                <span className="text-gray-400 text-xs w-6">#{m.waiver_priority ?? i + 1}</span>
                <span className="text-white">{m.team_name}</span>
              </li>
            ))}
          </ol>
          {isCommissioner && (
            <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap gap-2">
              <form action={processWaivers.bind(null, Number(id))}>
                <button
                  type="submit"
                  className="text-xs bg-yellow-400 hover:bg-yellow-300 text-black font-bold px-3 py-1.5 rounded-full transition"
                >
                  Process Waivers
                </button>
              </form>
              <form action={setWaiversLocked.bind(null, Number(id), false)}>
                <button
                  type="submit"
                  className="text-xs border border-white/10 hover:border-white/30 text-gray-300 px-3 py-1.5 rounded-full transition"
                >
                  Cancel Waivers
                </button>
              </form>
            </div>
          )}
        </details>
      )}

      {draftComplete && !waiversLocked && isCommissioner && (
        <div className="flex justify-end">
          <form action={setWaiversLocked.bind(null, Number(id), true)}>
            <button
              type="submit"
              className="text-xs border border-yellow-400/40 text-yellow-300 hover:text-white hover:border-yellow-300 font-medium px-3 py-1.5 rounded-full transition"
            >
              Start Waiver Period
            </button>
          </form>
        </div>
      )}

      <FreeAgencyList
        leagueId={Number(id)}
        freeAgents={freeAgents}
        leaderboard={leaderboard}
        myRoster={(myRoster ?? []) as any}
        openSpots={openSpots}
        overLimit={overLimit}
        addsDisabled={!draftComplete}
        myTeamId={myMember.id}
        seasonStarted={seasonStarted}
        waiversLocked={waiversLocked}
        pendingClaims={pendingClaims}
      />
    </div>
  );
}
