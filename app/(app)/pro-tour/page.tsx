import {
  DGPT_2026_SCHEDULE,
  formatEventDateRange,
  formatEventLocation,
  type DgptEvent,
} from "@/lib/dgpt-2026-schedule";

const MAJOR_SLUGS = new Set(["champions-cup", "pdga-pro-worlds", "usdgc"]);

function eventTier(event: DgptEvent): { label: string; color: string } {
  if (MAJOR_SLUGS.has(event.slug)) {
    return { label: "Major", color: "bg-yellow-500/20 text-yellow-400" };
  }
  return { label: "Elite Series", color: "bg-[#4B3DFF]/20 text-[#4B3DFF]" };
}

export default async function ProTourPage() {
  const today = new Date().toISOString().slice(0, 10);
  const recentEvents = DGPT_2026_SCHEDULE
    .filter((e) => e.endDate <= today)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))
    .slice(0, 6);

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

        {recentEvents.length === 0 ? (
          <p className="text-gray-600 text-sm py-4">No tournaments completed yet this season.</p>
        ) : (
          <div className="space-y-3">
            {recentEvents.map((event) => (
              <EventRow
                key={event.slug}
                event={event}
                date={formatEventDateRange(event)}
                location={formatEventLocation(event)}
                tier={eventTier(event)}
              />
            ))}
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

function EventRow({ event, date, location, tier }: {
  event: DgptEvent; date: string; location: string;
  tier: { label: string; color: string };
}) {
  const url = event.pdgaEventId
    ? `https://www.pdga.com/tour/event/${event.pdgaEventId}`
    : `https://www.pdga.com/tour/search?keys=${encodeURIComponent(event.name)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between p-4 rounded-xl bg-[#0f1117] border border-white/5 hover:border-white/15 transition gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tier.color}`}>
            {tier.label}
          </span>
        </div>
        <p className="text-white font-medium text-sm truncate">{event.name}</p>
        <p className="text-gray-500 text-xs mt-0.5 truncate">{date} · {location}</p>
      </div>
      <span className="text-gray-600 text-sm shrink-0">→</span>
    </a>
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
