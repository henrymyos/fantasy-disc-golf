import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FreeAgencyList } from "@/components/free-agency-list";
import { setWaiversLocked, processWaivers } from "@/actions/rosters";

export default async function FreeAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size, waivers_locked, commissioner_id")
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
    .select("id, name, division, world_ranking, overall_rank");

  const { data: resultRows } = await supabase
    .from("tournament_results")
    .select("player_id, fantasy_points");

  const pointsByPlayer = new Map<number, number>();
  (resultRows ?? []).forEach((r: any) => {
    pointsByPlayer.set(
      r.player_id,
      (pointsByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0),
    );
  });

  const seasonStarted = (resultRows ?? []).length > 0;

  const freeAgents = (allPlayers ?? [])
    .filter((p) => !rosteredIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      division: p.division,
      worldRanking: p.world_ranking as number | null,
      overallRank: (p as any).overall_rank as number | null,
      totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
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
        totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
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

      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold">Players</h2>
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
            <span className="text-gray-500 text-xs">
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
                <span className="text-gray-500 text-xs w-6">#{m.waiver_priority ?? i + 1}</span>
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
