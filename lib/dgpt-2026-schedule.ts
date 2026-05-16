// Hardcoded 2026 DGPT schedule fetched from dgpt.com/schedule.
// Slugs are stable identifiers used to store which events a league has
// chosen to include in its season.

export type DgptEvent = {
  slug: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  city: string;
  state: string | null;
  country: string;
  course: string | null;
  /** Numeric PDGA event ID — links to https://www.pdga.com/tour/event/{id} */
  pdgaEventId?: number;
};

export const DGPT_2026_SCHEDULE: DgptEvent[] = [
  { slug: "supreme-flight-open",        name: "Supreme Flight Open",                    startDate: "2026-02-27", endDate: "2026-03-01", city: "Brooksville",            state: "FL",   country: "USA",            course: "Olympus",                                  pdgaEventId: 96401 },
  { slug: "big-easy-open",              name: "MVP Big Easy Open",                      startDate: "2026-03-13", endDate: "2026-03-15", city: "Jefferson Parish",       state: "LA",   country: "USA",            course: "Parc des Familles",                        pdgaEventId: 96402 },
  { slug: "queen-city-classic",         name: "Queen City Classic",                     startDate: "2026-03-27", endDate: "2026-03-29", city: "Charlotte",              state: "NC",   country: "USA",            course: "Hornets Nest",                             pdgaEventId: 96403 },
  { slug: "champions-cup",              name: "PDGA Champions Cup",                     startDate: "2026-04-09", endDate: "2026-04-12", city: "Lynchburg",              state: "VA",   country: "USA",            course: null,                                       pdgaEventId: 97336 },
  { slug: "jonesboro-open",             name: "Play it Again Sports Jonesboro Open",    startDate: "2026-04-17", endDate: "2026-04-19", city: "Jonesboro",              state: "AR",   country: "USA",            course: "Disc Side of Heaven",                      pdgaEventId: 96404 },
  { slug: "kansas-city-wide-open",      name: "GRIPeq 44th Kansas City Wide Open",      startDate: "2026-04-24", endDate: "2026-04-26", city: "Liberty",                state: "MO",   country: "USA",            course: "Bad Rock Creek",                           pdgaEventId: 96407 },
  { slug: "barbasol-open-austin",       name: "Barbasol Open at Austin",                startDate: "2026-05-07", endDate: "2026-05-10", city: "Austin",                 state: "TX",   country: "USA",            course: "Harvey Penick, Sprinkle Valley",           pdgaEventId: 96408 },
  { slug: "otb-open",                   name: "OTB Open",                               startDate: "2026-05-21", endDate: "2026-05-24", city: "Stockton",               state: "CA",   country: "USA",            course: "Swenson Park A & B",                       pdgaEventId: 96409 },
  { slug: "northwest-championship",     name: "Northwest Championship",                 startDate: "2026-06-04", endDate: "2026-06-07", city: "Portland",               state: "OR",   country: "USA",            course: "Milo McIver, Glendoveer East",             pdgaEventId: 96410 },
  { slug: "european-open",              name: "European Open",                          startDate: "2026-06-18", endDate: "2026-06-21", city: "Tallinn",                state: null,   country: "Estonia",        course: "Song Festival Grounds",                    pdgaEventId: 97339 },
  { slug: "swedish-open",               name: "Swedish Open",                           startDate: "2026-06-26", endDate: "2026-06-28", city: "Borås",                  state: null,   country: "Sweden",         course: null,                                       pdgaEventId: 96411 },
  { slug: "ale-open",                   name: "Ale Open",                               startDate: "2026-07-03", endDate: "2026-07-05", city: "Nol",                    state: null,   country: "Sweden",         course: null,                                       pdgaEventId: 96412 },
  { slug: "heinola-open",               name: "Heinola Open",                           startDate: "2026-07-10", endDate: "2026-07-12", city: "Heinola",                state: null,   country: "Finland",        course: null,                                       pdgaEventId: 96413 },
  { slug: "ledgestone-open",            name: "Ledgestone Open",                        startDate: "2026-07-30", endDate: "2026-08-02", city: "Peoria",                 state: "IL",   country: "USA",            course: "Eureka Lake, Sunset Hills, Northwood Black", pdgaEventId: 96414 },
  { slug: "discmania-challenge",        name: "Discmania Challenge",                    startDate: "2026-08-07", endDate: "2026-08-09", city: "Indianola",              state: "IA",   country: "USA",            course: "Pickard Park",                             pdgaEventId: 96415 },
  { slug: "pdga-pro-worlds",            name: "PDGA Pro World Championships",           startDate: "2026-08-26", endDate: "2026-08-30", city: "Milford",                state: "MI",   country: "USA",            course: null,                                       pdgaEventId: 97344 },
  { slug: "lws-open-idlewild",          name: "LWS Open at Idlewild",                   startDate: "2026-09-04", endDate: "2026-09-06", city: "Burlington",             state: "KY",   country: "USA",            course: "Idlewild",                                 pdgaEventId: 96417 },
  { slug: "green-mountain-championship",name: "Green Mountain Championship",            startDate: "2026-09-17", endDate: "2026-09-20", city: "Jeffersonville",         state: "VT",   country: "USA",            course: "Brewster Ridge, Fox Run Meadows",          pdgaEventId: 96418 },
  { slug: "mvp-open-otb",               name: "MVP Open x OTB",                         startDate: "2026-09-24", endDate: "2026-09-27", city: "Leicester",              state: "MA",   country: "USA",            course: "Maple Hill",                               pdgaEventId: 96419 },
  { slug: "usdgc",                      name: "USDGC / Throw Pink Women's Championship", startDate: "2026-10-08", endDate: "2026-10-11", city: "Rock Hill",              state: "SC",   country: "USA",            course: "Winthrop Grounds",                         pdgaEventId: 97346 },
];

export const DGPT_2026_SLUGS = DGPT_2026_SCHEDULE.map((e) => e.slug);

/** Resolves the effective season list given a possibly-null stored selection.
 *  Null/undefined => all events. */
export function effectiveSelection(stored: string[] | null | undefined): string[] {
  if (stored == null) return DGPT_2026_SLUGS;
  return stored;
}

export function formatEventDateRange(e: DgptEvent): string {
  const start = new Date(e.startDate + "T00:00:00");
  const end = new Date(e.endDate + "T00:00:00");
  const fmt = (d: Date, includeYear: boolean) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {}),
    });
  if (start.getMonth() === end.getMonth()) {
    return `${fmt(start, false)}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

export function formatEventLocation(e: DgptEvent): string {
  if (e.country !== "USA") return `${e.city}, ${e.country}`;
  return e.state ? `${e.city}, ${e.state}` : e.city;
}

/** Number of selected events at the end of the season treated as playoffs. */
export const PLAYOFF_COUNT = 3;

/** Returns the slugs of the last N selected events (chronologically by end date)
 *  that should be treated as playoffs. */
export function getPlayoffSlugs(
  selectedSlugs: Iterable<string>,
  n: number = PLAYOFF_COUNT
): string[] {
  const selectedSet = new Set(selectedSlugs);
  const selectedEvents = DGPT_2026_SCHEDULE.filter((e) => selectedSet.has(e.slug));
  selectedEvents.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return selectedEvents.slice(0, n).map((e) => e.slug);
}
