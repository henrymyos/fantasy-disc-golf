import Link from "next/link";
import { getRecentEvents, type PDGAEvent } from "@/lib/pdga";

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: "Major", color: "bg-yellow-500/20 text-yellow-400" },
  A: { label: "Elite Series", color: "bg-[#4B3DFF]/20 text-[#4B3DFF]" },
  ES: { label: "Elite Series", color: "bg-[#4B3DFF]/20 text-[#4B3DFF]" },
  XS: { label: "XS", color: "bg-white/10 text-gray-400" },
};

// Known recent DGPT events as fallback when PDGA API creds not configured
const FALLBACK_EVENTS = [
  { id: 97054, name: "JomezPro - Innova presents WACO powered by Legit Disc Golf", date: "May 1–3, 2026", location: "Waco, TX", tier: "A", pdgaLiveId: 102001 },
  { id: 97336, name: "2026 PDGA Champions Cup Presented by Vessi", date: "Apr 9–12, 2026", location: "Lynchburg, VA", tier: "M", pdgaLiveId: 97336 },
  { id: 96403, name: "Queen City Classic presented by Another Round", date: "Mar 27–29, 2026", location: "Charlotte, NC", tier: "A", pdgaLiveId: 96403 },
  { id: 96401, name: "Discraft's Supreme Flight Open presented by Florida's Adventure Coast", date: "Feb 27 – Mar 1, 2026", location: "Brooksville, FL", tier: "A", pdgaLiveId: 96401 },
];

export default async function ProTourPage() {
  const hasCredentials = !!(process.env.PDGA_USERNAME && process.env.PDGA_PASSWORD);
  let apiEvents: PDGAEvent[] = [];

  if (hasCredentials) {
    apiEvents = await getRecentEvents(10);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Pro Tour</h1>
        <a
          href="https://www.pdga.com/live/events"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm bg-[#36D7B7]/20 text-[#36D7B7] hover:bg-[#36D7B7]/30 px-4 py-2 rounded-lg transition"
        >
          <span className="w-2 h-2 rounded-full bg-[#36D7B7] animate-pulse" />
          PDGA Live Scoring
        </a>
      </div>

      {/* Live now banner */}
      <div className="bg-[#36D7B7]/10 border border-[#36D7B7]/30 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-[#36D7B7] animate-pulse" />
          <h2 className="text-[#36D7B7] font-semibold text-sm uppercase tracking-wide">Live / Recent Scoring</h2>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          Follow live round-by-round scoring for all PDGA events on PDGA Live.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="https://www.pdga.com/live/events" target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-semibold text-sm rounded-lg transition">
            View All Live Events
          </a>
          <a href="https://www.dgpt.com/schedule/" target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 border border-white/10 hover:border-white/20 text-gray-300 text-sm rounded-lg transition">
            DGPT Schedule
          </a>
        </div>
      </div>

      {/* Recent events */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-4">Recent Tournaments</h2>

        {apiEvents.length > 0 ? (
          <div className="space-y-3">
            {apiEvents.map((event) => {
              const tier = TIER_LABELS[event.tier] ?? { label: event.tier, color: "bg-white/10 text-gray-400" };
              return (
                <EventRow
                  key={event.tournament_id}
                  name={event.tournament_name}
                  date={`${event.start_date} – ${event.end_date}`}
                  location={`${event.city}, ${event.state_prov}`}
                  tier={tier}
                  pdgaLiveId={event.tournament_id}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {FALLBACK_EVENTS.map((event) => {
              const tier = TIER_LABELS[event.tier] ?? { label: event.tier, color: "bg-white/10 text-gray-400" };
              return (
                <EventRow
                  key={event.id}
                  name={event.name}
                  date={event.date}
                  location={event.location}
                  tier={tier}
                  pdgaLiveId={event.pdgaLiveId}
                />
              );
            })}
            {!hasCredentials && (
              <p className="text-gray-600 text-xs mt-3 pt-3 border-t border-white/5">
                Add PDGA_USERNAME and PDGA_PASSWORD to .env.local to auto-fetch live event data.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Player rankings */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white">World Rankings</h2>
          <a
            href="https://www.pdga.com/world-rankings"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#36D7B7] hover:underline"
          >
            Full rankings →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <RankingsList division="MPO" players={MPO_TOP_10} />
          <RankingsList division="FPO" players={FPO_TOP_10} />
        </div>
      </div>
    </div>
  );
}

function EventRow({ name, date, location, tier, pdgaLiveId }: {
  name: string; date: string; location: string;
  tier: { label: string; color: string }; pdgaLiveId: number;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-[#0f1117] border border-white/5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tier.color}`}>
            {tier.label}
          </span>
        </div>
        <p className="text-white font-medium text-sm truncate">{name}</p>
        <p className="text-gray-500 text-xs mt-0.5">{date} · {location}</p>
      </div>
      <div className="flex gap-2 ml-4 shrink-0">
        <a
          href={`https://www.pdga.com/live/event/${pdgaLiveId}/MPO/scores`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs border border-white/10 hover:border-[#4B3DFF]/50 text-gray-400 hover:text-white px-3 py-1.5 rounded-full transition"
        >
          MPO
        </a>
        <a
          href={`https://www.pdga.com/live/event/${pdgaLiveId}/FPO/scores`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs border border-white/10 hover:border-[#36D7B7]/50 text-gray-400 hover:text-[#36D7B7] px-3 py-1.5 rounded-full transition"
        >
          FPO
        </a>
      </div>
    </div>
  );
}

function RankingsList({ division, players }: { division: string; players: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{division}</h3>
      <div className="space-y-1.5">
        {players.map((name, i) => (
          <div key={name} className="flex items-center gap-2">
            <span className="text-gray-600 text-xs w-4">{i + 1}</span>
            <span className="text-gray-300 text-sm">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MPO_TOP_10 = [
  "Gannon Buhr", "Ricky Wysocki", "Niklas Anttila", "Calvin Heimburg",
  "Isaac Robinson", "Paul McBeth", "Anthony Barela", "Cole Redalen",
  "Adam Hammes", "Kyle Klein",
];

const FPO_TOP_10 = [
  "Holyn Handley", "Missy Gannon", "Ohn Scoggins", "Silva Saarinen",
  "Kristin Lätt", "Eveliina Salonen", "Henna Blomroos", "Paige Pierce",
  "Valerie Mandujano", "Cadence Burge",
];
