export type WrapupRow = {
  name: string;
  division: "MPO" | "FPO";
  actual: number | null;
  projected: number | null;
};

export type TeamWrapup = {
  teamName: string;
  starters: (WrapupRow | null)[];
  bench: WrapupRow[];
  mpoSlots: number;
  fpoSlots: number;
};

type Superlative = { name: string; teamName: string; actual: number; projected: number | null };

/** Best-possible starter total from the full roster (top N by actual per division). */
function optimalTotal(team: TeamWrapup): number {
  const all = [...team.starters.filter((r): r is WrapupRow => r != null), ...team.bench];
  const top = (division: "MPO" | "FPO", n: number) =>
    all
      .filter((r) => r.division === division)
      .map((r) => r.actual ?? 0)
      .sort((a, b) => b - a)
      .slice(0, n)
      .reduce((s, v) => s + v, 0);
  return top("MPO", team.mpoSlots) + top("FPO", team.fpoSlots);
}

export function computeWrapup(t1: TeamWrapup, t2: TeamWrapup) {
  const starters: Superlative[] = [];
  for (const team of [t1, t2]) {
    for (const r of team.starters) {
      if (r?.actual != null) {
        starters.push({ name: r.name, teamName: team.teamName, actual: r.actual, projected: r.projected });
      }
    }
  }
  if (starters.length === 0) return null;

  const mvp = starters.reduce((a, b) => (b.actual > a.actual ? b : a));
  // Biggest bust: largest shortfall vs projection, and it has to be a real
  // whiff (≥ 5 pts under) on a real projection — otherwise nobody busted.
  const bust = starters
    .filter((s) => s.projected != null && s.projected - s.actual >= 5)
    .reduce<Superlative | null>(
      (a, b) => (a == null || b.projected! - b.actual > a.projected! - a.actual ? b : a),
      null,
    );

  const benchRegret = [t1, t2].map((team) => {
    const started = team.starters.reduce((s, r) => s + (r?.actual ?? 0), 0);
    const left = Math.max(0, Math.round((optimalTotal(team) - started) * 10) / 10);
    return { teamName: team.teamName, left };
  });

  return { mvp, bust, benchRegret };
}

/** Post-final matchup wrap-up: MVP, biggest bust, points left on the bench. */
export function MatchupWrapup({ t1, t2 }: { t1: TeamWrapup; t2: TeamWrapup }) {
  const w = computeWrapup(t1, t2);
  if (!w) return null;
  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
      <div className="px-4 py-2 border-b border-white/5 bg-[#0f1117]">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
          Week wrap-up
        </span>
      </div>
      <div className="divide-y divide-white/5">
        <div className="px-4 py-3 flex items-center gap-3">
          <span className="text-lg shrink-0">🏆</span>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-medium">Matchup MVP: {w.mvp.name}</p>
            <p className="text-gray-400 text-xs mt-0.5">
              {w.mvp.actual.toFixed(1)} pts for {w.mvp.teamName}
              {w.mvp.projected != null && <> · projected ~{w.mvp.projected.toFixed(1)}</>}
            </p>
          </div>
        </div>
        {w.bust && (
          <div className="px-4 py-3 flex items-center gap-3">
            <span className="text-lg shrink-0">🥶</span>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium">Biggest bust: {w.bust.name}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {w.bust.actual.toFixed(1)} pts for {w.bust.teamName} · projected ~{w.bust.projected!.toFixed(1)}
              </p>
            </div>
          </div>
        )}
        {w.benchRegret.map((b) => (
          <div key={b.teamName} className="px-4 py-3 flex items-center gap-3">
            <span className="text-lg shrink-0">🪑</span>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium">
                {b.teamName} left {b.left.toFixed(1)} pts on the bench
              </p>
              <p className="text-gray-400 text-xs mt-0.5">
                {b.left > 0 ? "vs their best possible lineup this week" : "Perfect lineup — nothing left behind"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
