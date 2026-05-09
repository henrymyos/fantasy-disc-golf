import { BONUS_POINTS } from "@/actions/scoring";

const PLACEMENT_TABLE = [
  { pos: "1st",     pts: 110 },
  { pos: "2nd",     pts: 92 },
  { pos: "3rd",     pts: 78 },
  { pos: "4th",     pts: 68 },
  { pos: "5th",     pts: 60 },
  { pos: "6th",     pts: 54 },
  { pos: "7th",     pts: 49 },
  { pos: "8th",     pts: 45 },
  { pos: "9th",     pts: 41 },
  { pos: "10th",    pts: 38 },
  { pos: "11th",    pts: 35 },
  { pos: "12th",    pts: 32 },
  { pos: "13th",    pts: 30 },
  { pos: "14th",    pts: 28 },
  { pos: "15th",    pts: 26 },
  { pos: "16th",    pts: 24 },
  { pos: "17th",    pts: 23 },
  { pos: "18th",    pts: 21 },
  { pos: "19th",    pts: 20 },
  { pos: "20th",    pts: 19 },
  { pos: "21st",    pts: 18 },
  { pos: "22nd",    pts: 17 },
  { pos: "23rd–24th", pts: 16 },
  { pos: "25th",    pts: 15 },
  { pos: "26th–27th", pts: 14 },
  { pos: "28th–29th", pts: 13 },
  { pos: "30th",    pts: 12 },
  { pos: "31st–35th", pts: 11 },
  { pos: "36th–40th", pts: 10 },
  { pos: "41st–45th", pts: 8 },
  { pos: "46th–50th", pts: 7 },
  { pos: "51st–60th", pts: 5 },
  { pos: "61st–70th", pts: 3 },
  { pos: "71st+",   pts: 2 },
];

export function ScoringRules() {
  return (
    <div className="space-y-6">
      {/* Bonus points */}
      <div>
        <h3 className="text-white font-semibold mb-3">Bonus Points</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🔥</div>
            <div className="text-white font-bold text-xl">+{BONUS_POINTS.hotRound}</div>
            <div className="text-gray-400 text-xs mt-1">Hot Round</div>
            <div className="text-gray-600 text-xs mt-0.5">Best score in a round</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">✅</div>
            <div className="text-white font-bold text-xl">+{BONUS_POINTS.bogeyFree}</div>
            <div className="text-gray-400 text-xs mt-1">Bogey-Free Round</div>
            <div className="text-gray-600 text-xs mt-0.5">Per round, no bogeys</div>
          </div>
          <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-white font-bold text-xl">+{BONUS_POINTS.ace}</div>
            <div className="text-gray-400 text-xs mt-1">Ace</div>
            <div className="text-gray-600 text-xs mt-0.5">Hole-in-one</div>
          </div>
        </div>
        <p className="text-gray-600 text-xs mt-2">
          Tied players share averaged points. Bonuses stack per round.
        </p>
      </div>

      {/* Placement points table */}
      <div>
        <h3 className="text-white font-semibold mb-3">Placement Points</h3>
        <div className="grid grid-cols-2 gap-x-4">
          {PLACEMENT_TABLE.map(({ pos, pts }) => (
            <div
              key={pos}
              className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
            >
              <span className="text-gray-400 text-sm">{pos}</span>
              <span className="text-white font-medium text-sm tabular-nums">{pts} pts</span>
            </div>
          ))}
        </div>
        <p className="text-gray-600 text-xs mt-3">
          Calibrated so a 6-starter team averages ~150 pts per tournament.
        </p>
      </div>
    </div>
  );
}
