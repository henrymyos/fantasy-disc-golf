type Entrant = {
  teamName: string;
  username?: string | null;
  wins: number;
  losses: number;
  points: number;
};

/**
 * End-of-season recap shown on the league home once the season is over.
 * Highlights the champion plus, when applicable, the consolation champ (best
 * team that missed the playoffs) and the last-place finisher.
 */
export function SeasonReview({
  seasonYear,
  champion,
  consolationChamp,
  lastPlace,
}: {
  seasonYear: number;
  champion: Entrant;
  consolationChamp: Entrant | null;
  lastPlace: Entrant | null;
}) {
  const record = (e: Entrant) => `${e.wins}-${e.losses} · ${e.points.toFixed(0)} pts`;

  return (
    <div className="bg-gradient-to-b from-[#4B3DFF]/15 to-[#1a1d23] rounded-2xl p-5 border border-[#4B3DFF]/30">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-white">{seasonYear} Season Review</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#a09aff] bg-[#4B3DFF]/20 px-2 py-0.5 rounded-full">
          Final
        </span>
      </div>

      {/* Champion */}
      <div className="flex items-center gap-3 rounded-xl bg-[#F5A524]/10 border border-[#F5A524]/30 px-4 py-3">
        <span className="text-2xl" aria-hidden>🏆</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#F5A524]">Champion</p>
          <p className="text-white font-bold truncate">{champion.teamName}</p>
          {champion.username && <p className="text-gray-400 text-xs truncate">{champion.username}</p>}
        </div>
        <span className="text-gray-300 text-xs shrink-0">{record(champion)}</span>
      </div>

      {(consolationChamp || lastPlace) && (
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          {consolationChamp && (
            <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/5 px-4 py-3">
              <span className="text-xl" aria-hidden>🏅</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#36D7B7]">Consolation Champ</p>
                <p className="text-white font-medium truncate">{consolationChamp.teamName}</p>
              </div>
              <span className="text-gray-400 text-[11px] shrink-0">{record(consolationChamp)}</span>
            </div>
          )}
          {lastPlace && (
            <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/5 px-4 py-3">
              <span className="text-xl" aria-hidden>🥄</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Last Place</p>
                <p className="text-white font-medium truncate">{lastPlace.teamName}</p>
              </div>
              <span className="text-gray-400 text-[11px] shrink-0">{record(lastPlace)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
