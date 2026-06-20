/**
 * Instant loading skeleton shown while a league tab's data streams in. The
 * league header + tab bar (in layout.tsx) stay put and interactive; only this
 * content area swaps, so switching tabs gives immediate "it's working" feedback
 * instead of a frozen screen.
 */
export default function LeagueLoading() {
  return (
    <div className="grid lg:grid-cols-3 gap-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="lg:col-span-1 rounded-2xl bg-[#1a1d23] border border-white/5 p-5 space-y-3">
        <div className="h-5 w-24 rounded bg-white/10" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-11 rounded-lg bg-white/[0.04]" />
        ))}
      </div>
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-2xl bg-[#1a1d23] border border-white/5 p-5 space-y-3">
          <div className="h-5 w-40 rounded bg-white/10" />
          <div className="h-16 rounded-xl bg-white/[0.04]" />
          <div className="h-16 rounded-xl bg-white/[0.04]" />
        </div>
        <div className="rounded-2xl bg-[#1a1d23] border border-white/5 p-5 space-y-3">
          <div className="h-5 w-32 rounded bg-white/10" />
          <div className="h-12 rounded-xl bg-white/[0.04]" />
          <div className="h-12 rounded-xl bg-white/[0.04]" />
          <div className="h-12 rounded-xl bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}
