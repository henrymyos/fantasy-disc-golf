import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";

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

  const { data: events } = await supabase
    .from("tournaments")
    .select(`
      id, name, week, start_date, pdga_event_id,
      tournament_results(fantasy_points, finishing_position, hot_round_count, bogey_free_count, ace_count)
    `)
    .eq("tournament_results.player_id", playerId)
    .order("start_date", { ascending: true });

  const isMpo = player.division === "MPO";
  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

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
                <p className="text-white font-bold text-lg">{totalPts.toFixed(1)}</p>
                <p className="text-gray-500 text-xs">Total pts</p>
              </div>
              {avgFinish && (
                <div className="text-center">
                  <p className="text-white font-bold text-lg">{avgFinish}</p>
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
                    style={{ color: accentColor }}
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
