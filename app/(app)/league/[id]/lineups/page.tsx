import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toggleStarter, dropPlayer } from "@/actions/rosters";

export default async function LineupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, starters_count, roster_size")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!myMember) redirect("/dashboard");

  const { data: myRoster } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", myMember.id)
    .order("is_starter", { ascending: false });

  const starters = (myRoster ?? []).filter((r) => r.is_starter);
  const bench = (myRoster ?? []).filter((r) => !r.is_starter);

  return (
    <div className="max-w-2xl space-y-6">
      {/* My lineup */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white">{myMember.team_name}</h2>
          <span className="text-gray-500 text-sm">{starters.length}/{league.starters_count} starters</span>
        </div>

        {(myRoster ?? []).length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">
            No players on your roster. Add players in Free Agency.
          </p>
        ) : (
          <div className="space-y-4">
            <section>
              <h3 className="text-xs text-[#36D7B7] font-semibold uppercase tracking-wide mb-2">
                Starters ({starters.length}/{league.starters_count})
              </h3>
              <div className="space-y-2">
                {starters.map((spot) => (
                  <PlayerRow
                    key={spot.id}
                    spot={spot}
                    isStarter
                    leagueId={Number(id)}
                    maxStarters={league.starters_count}
                    currentStarters={starters.length}
                  />
                ))}
                {starters.length === 0 && (
                  <p className="text-gray-600 text-sm py-2">No starters set — click "Start" on bench players</p>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Bench</h3>
              <div className="space-y-2">
                {bench.map((spot) => (
                  <PlayerRow
                    key={spot.id}
                    spot={spot}
                    isStarter={false}
                    leagueId={Number(id)}
                    maxStarters={league.starters_count}
                    currentStarters={starters.length}
                  />
                ))}
                {bench.length === 0 && (
                  <p className="text-gray-600 text-sm py-2">Bench is empty</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({
  spot,
  isStarter,
  leagueId,
  maxStarters,
  currentStarters,
}: {
  spot: any;
  isStarter: boolean;
  leagueId: number;
  maxStarters: number;
  currentStarters: number;
}) {
  const player = spot.players;
  const canStart = !isStarter && currentStarters < maxStarters;

  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-[#0f1117] border border-white/5 group">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          isStarter ? "bg-[#36D7B7] text-black" : "bg-white/10 text-white"
        }`}>
          {player?.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{player?.name}</p>
          <p className="text-gray-600 text-xs">{player?.division ?? "MPO"}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
        {isStarter ? (
          <form action={toggleStarter.bind(null, leagueId, spot.id, false)}>
            <button type="submit" className="text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1 rounded-full transition">
              Bench
            </button>
          </form>
        ) : canStart ? (
          <form action={toggleStarter.bind(null, leagueId, spot.id, true)}>
            <button type="submit" className="text-xs text-[#36D7B7] border border-[#36D7B7]/40 hover:border-[#36D7B7] px-3 py-1 rounded-full transition">
              Start
            </button>
          </form>
        ) : null}
        <form action={dropPlayer.bind(null, leagueId, spot.player_id)}>
          <button type="submit" className="text-xs text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-3 py-1 rounded-full transition">
            Drop
          </button>
        </form>
      </div>
    </div>
  );
}
