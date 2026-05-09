import { BONUS_POINTS } from "@/lib/scoring-constants";

const MPO_TABLE = [
  { pos: "1st",       pts: 82 },
  { pos: "2nd",       pts: 70 },
  { pos: "3rd",       pts: 60 },
  { pos: "4th",       pts: 53 },
  { pos: "5th",       pts: 47 },
  { pos: "6th",       pts: 42 },
  { pos: "7th",       pts: 38 },
  { pos: "8th",       pts: 35 },
  { pos: "9th",       pts: 32 },
  { pos: "10th",      pts: 29 },
  { pos: "11th",      pts: 26 },
  { pos: "12th",      pts: 24 },
  { pos: "13th",      pts: 22 },
  { pos: "14th",      pts: 20 },
  { pos: "15th",      pts: 19 },
  { pos: "16th",      pts: 18 },
  { pos: "17th",      pts: 17 },
  { pos: "18th",      pts: 16 },
  { pos: "19th–20th", pts: 15 },
  { pos: "21st",      pts: 13 },
  { pos: "22nd",      pts: 12 },
  { pos: "23rd–24th", pts: 11 },
  { pos: "25th–26th", pts: 10 },
  { pos: "27th–30th", pts: 9  },
  { pos: "31st–32nd", pts: 8  },
  { pos: "33rd–40th", pts: 6  },
  { pos: "41st–50th", pts: 4  },
  { pos: "51st–60th", pts: 3  },
  { pos: "61st+",     pts: 1  },
];

const FPO_TABLE = [
  { pos: "1st",       pts: 54 },
  { pos: "2nd",       pts: 46 },
  { pos: "3rd",       pts: 40 },
  { pos: "4th",       pts: 35 },
  { pos: "5th",       pts: 31 },
  { pos: "6th",       pts: 28 },
  { pos: "7th",       pts: 25 },
  { pos: "8th",       pts: 23 },
  { pos: "9th",       pts: 21 },
  { pos: "10th",      pts: 18 },
  { pos: "11th",      pts: 17 },
  { pos: "12th",      pts: 15 },
  { pos: "13th",      pts: 14 },
  { pos: "14th",      pts: 13 },
  { pos: "15th",      pts: 12 },
  { pos: "16th",      pts: 11 },
  { pos: "17th–25th", pts: 9  },
  { pos: "26th–35th", pts: 6  },
  { pos: "36th–45th", pts: 4  },
  { pos: "46th+",     pts: 2  },
];

export function ScoringRules() {
  return (
    <div className="space-y-6">
      {/* Lineup structure */}
      <div className="bg-[#0f1117] rounded-xl p-4 border border-white/5">
        <p className="text-sm text-gray-300 font-medium mb-2">Lineup Structure</p>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-sm font-bold text-[#4B3DFF]">4</span>
            <span className="text-gray-400 text-sm">MPO starters</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#36D7B7]/20 border border-[#36D7B7]/30 flex items-center justify-center text-sm font-bold text-[#36D7B7]">2</span>
            <span className="text-gray-400 text-sm">FPO starters</span>
          </div>
        </div>
        <p className="text-gray-600 text-xs mt-2">Both divisions calibrated to ~25 pts/starter avg → ~150 pts/team per tournament.</p>
      </div>

      {/* Bonus points */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">Bonus Points</p>
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
        <p className="text-gray-600 text-xs mt-2">Tied players share averaged points. Bonuses stack per round.</p>
      </div>

      {/* Placement tables side by side */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            MPO Placement
            <span className="text-xs text-gray-600 font-normal">4 starters</span>
          </p>
          <div className="space-y-0">
            {MPO_TABLE.map(({ pos, pts }) => (
              <div key={pos} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-400 text-sm">{pos}</span>
                <span className="text-white font-medium text-sm tabular-nums">{pts}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-[#36D7B7] mb-3 flex items-center gap-2">
            FPO Placement
            <span className="text-xs text-gray-600 font-normal">2 starters</span>
          </p>
          <div className="space-y-0">
            {FPO_TABLE.map(({ pos, pts }) => (
              <div key={pos} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-400 text-sm">{pos}</span>
                <span className="text-[#36D7B7] font-medium text-sm tabular-nums">{pts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
