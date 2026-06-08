import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLAYOFF_COUNT } from "@/lib/dgpt-2026-schedule";
import { getPlayoffOutcome } from "@/lib/playoff-outcome";
import type { BracketSlot } from "@/lib/playoffs";

function roundLabel(index: number, total: number): string {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${index + 1}`;
}

export default async function PlayoffsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase.from("leagues").select("id, name").eq("id", id).single();
  if (!league) notFound();

  const outcome = await getPlayoffOutcome(supabase, Number(id));
  const { standings, bracketSize, playoffEvents, result, championTeamId } = outcome;
  const totalRounds = bracketSize >= 2 ? Math.log2(bracketSize) : 0;
  const championName = championTeamId != null ? outcome.champion?.teamName : null;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-white font-bold text-xl">Playoff Bracket</h2>
        <p className="text-gray-400 text-sm mt-1">
          {playoffEvents.length > 0 ? (
            <>Winners advance on weekly score · {playoffEvents.map((e) => e.name).join(" → ")}</>
          ) : (
            <>Set up your season schedule to populate the playoffs. The last {PLAYOFF_COUNT} selected events become the bracket.</>
          )}
        </p>
      </div>

      {bracketSize < 2 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">Not enough teams or playoff events to seed a bracket yet.</p>
        </div>
      ) : (
        <>
          {championName && (
            <div className="rounded-2xl p-5 border border-[#F5A524]/40 bg-gradient-to-b from-[#F5A524]/15 to-[#1a1d23] flex items-center gap-3">
              <span className="text-3xl" aria-hidden>🏆</span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#F5A524]">Champion</p>
                <p className="text-white font-bold text-lg">{championName}</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {result.rounds.map((round, ri) => (
              <div key={ri} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white font-semibold">{roundLabel(ri, totalRounds)}</p>
                  <p className="text-gray-400 text-xs">{round.name}</p>
                </div>
                <div className="space-y-3">
                  {round.matches.map((m, mi) => (
                    <div key={mi} className="bg-[#0f1117] border border-white/5 rounded-xl p-3">
                      <TeamLine slot={m.a} isWinner={m.decided && m.winnerTeamId === m.a?.teamId} loser={m.decided && m.winnerTeamId !== m.a?.teamId} />
                      <div className="text-center text-gray-500 text-[11px] my-1">vs</div>
                      <TeamLine slot={m.b} isWinner={m.decided && m.winnerTeamId === m.b?.teamId} loser={m.decided && m.winnerTeamId !== m.b?.teamId} />
                      {!m.decided && (
                        <p className="text-gray-500 text-[11px] text-center mt-1.5">
                          {round.matches.length > 0 && playoffEvents.find((e) => e.name === round.name)?.complete === false
                            ? "Awaiting this event's results"
                            : "To be decided"}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {result.rounds.length < totalRounds && (
              <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 text-center">
                <p className="text-gray-400 text-sm">
                  {totalRounds - result.rounds.length} more round{totalRounds - result.rounds.length !== 1 ? "s" : ""} to come once
                  earlier matchups are decided.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {standings.length > 0 && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Seeding &amp; tiebreakers</h3>
            <span className="text-gray-400 text-[11px]">SoS = avg opponent win rate</span>
          </div>
          <div className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] gap-x-3 text-xs">
            <div className="contents text-gray-500">
              <span></span>
              <span className="pb-1">Team</span>
              <span className="pb-1 text-right">W-L</span>
              <span className="pb-1 text-right">Pts</span>
              <span className="pb-1 text-right">SoS</span>
            </div>
            {standings.map((t, i) => {
              const inBracket = i < bracketSize;
              return (
                <div
                  key={t.teamId}
                  className={`contents ${i === bracketSize ? "[&>*]:border-t [&>*]:border-dashed [&>*]:border-[#4B3DFF]/40 [&>*]:pt-2" : ""}`}
                >
                  <span className={`py-1.5 font-mono ${inBracket ? "text-[#4B3DFF]" : "text-gray-500"}`}>#{i + 1}</span>
                  <span className={`py-1.5 truncate ${inBracket ? "text-white" : "text-gray-300"}`}>{t.teamName}</span>
                  <span className="py-1.5 text-right text-gray-300">{t.wins}-{t.losses}</span>
                  <span className="py-1.5 text-right text-gray-400">{t.points.toFixed(0)}</span>
                  <span className="py-1.5 text-right text-gray-400">{t.sos >= 0 ? `${Math.round(t.sos * 100)}%` : "—"}</span>
                </div>
              );
            })}
          </div>
          <p className="text-gray-500 text-[11px] mt-3 leading-relaxed">
            Top {bracketSize} seeds make the bracket (dashed line = cut). Each round is one playoff event; the higher
            weekly score advances, ties going to the higher seed.
          </p>
        </div>
      )}
    </div>
  );
}

function TeamLine({ slot, isWinner, loser }: { slot: BracketSlot; isWinner: boolean; loser: boolean }) {
  if (!slot) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">TBD</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-between text-sm ${loser ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-gray-500 text-xs font-mono w-5 shrink-0">#{slot.seed}</span>
        <span className={`truncate ${isWinner ? "text-white font-semibold" : "text-gray-200"}`}>{slot.teamName}</span>
        {isWinner && <span className="text-[#36D7B7] text-xs shrink-0">✓</span>}
      </div>
      <span className={`shrink-0 tabular-nums ${isWinner ? "text-[#36D7B7] font-semibold" : "text-gray-400"}`}>
        {slot.score != null ? slot.score.toFixed(1) : "—"}
      </span>
    </div>
  );
}
