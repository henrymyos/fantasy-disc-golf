import { describeFeedEvent } from "@/lib/gameday";

export type LiveFeedRow = {
  id: number;
  playerName: string;
  teamName: string | null;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

const KIND_EMOJI: Record<string, string> = {
  ace: "🎯",
  hot_round: "🔥",
  eagle: "🦅",
  bogey_free: "✨",
  birdies: "🐦",
  position: "↕️",
  score: "📋",
};

function relativeTime(ts: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Scrolling play-by-play of live stat changes for the players in a matchup. */
export function LiveEventFeed({ rows }: { rows: LiveFeedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
      <div className="px-4 py-2 border-b border-white/5 bg-[#0f1117] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#36D7B7] animate-pulse" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
          Live play-by-play
        </span>
      </div>
      <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-2.5 flex items-start gap-2.5">
            <span className="text-sm leading-5 shrink-0">{KIND_EMOJI[r.kind] ?? "📋"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white leading-5">
                <span className="font-medium">{r.playerName}</span>{" "}
                <span className="text-gray-300">{describeFeedEvent(r.kind, r.detail)}</span>
              </p>
              {r.teamName && (
                <p className="text-[11px] text-gray-500 leading-tight">{r.teamName}</p>
              )}
            </div>
            <span className="text-[11px] text-gray-500 shrink-0 leading-5">{relativeTime(r.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
