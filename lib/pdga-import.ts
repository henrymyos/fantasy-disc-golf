// Importer used by both the CLI script and the /api/sync-pdga cron route.
// Scrapes the PDGA tournament HTML pages, matches results against our players
// table, computes fantasy_points, and refreshes tournament_results.
// Tied players each receive the full points for their finishing position.

import type { SupabaseClient } from "@supabase/supabase-js";

const MPO_PLACEMENT_POINTS: Record<number, number> = {
  1: 82,  2: 70,  3: 60,  4: 53,  5: 47,  6: 42,  7: 38,  8: 35,  9: 32,  10: 29,
  11: 26, 12: 24, 13: 22, 14: 20, 15: 19, 16: 18, 17: 17, 18: 16, 19: 16, 20: 15,
  21: 13, 22: 12, 23: 11, 24: 11, 25: 10, 26: 10, 27: 9,  28: 9,  29: 9,  30: 9,
  31: 8,  32: 8,
  33: 6,  34: 6,  35: 6,  36: 6,  37: 6,  38: 6,  39: 6,  40: 6,
  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,  46: 4,  47: 4,  48: 4,  49: 4,  50: 4,
};
const FPO_PLACEMENT_POINTS: Record<number, number> = {
  1: 54,  2: 46,  3: 40,  4: 35,  5: 31,  6: 28,  7: 25,  8: 23,
  9: 21,  10: 18, 11: 17, 12: 15, 13: 14, 14: 13, 15: 12, 16: 11,
  17: 9,  18: 9,  19: 9,  20: 9,  21: 9,  22: 9,  23: 9,  24: 9,  25: 9,
  26: 6,  27: 6,  28: 6,  29: 6,  30: 6,  31: 6,  32: 6,  33: 6,  34: 6,  35: 6,
  36: 4,  37: 4,  38: 4,  39: 4,  40: 4,  41: 4,  42: 4,  43: 4,  44: 4,  45: 4,
};

function pointsFor(position: number, division: "MPO" | "FPO"): number {
  const isFPO = division === "FPO";
  const table = isFPO ? FPO_PLACEMENT_POINTS : MPO_PLACEMENT_POINTS;
  if (position <= (isFPO ? 45 : 50)) return table[position] ?? 1;
  if (position <= 60) return isFPO ? 2 : 3;
  return 1;
}

type ParsedRow = { place: number; pdgaNumber: number; name: string };

async function fetchEventHtml(pdgaId: number): Promise<string> {
  const r = await fetch(`https://www.pdga.com/tour/event/${pdgaId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`PDGA event ${pdgaId} returned ${r.status}`);
  return r.text();
}

function parseResultsTable(html: string, tableId: string): ParsedRow[] {
  const tableRe = new RegExp(
    `<table[^>]*id="${tableId}"[\\s\\S]*?</table>`,
    "i",
  );
  const tableMatch = html.match(tableRe);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];

  const rows: ParsedRow[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const placeMatch = row.match(/<td[^>]*class="place"[^>]*>([^<]*)<\/td>/);
    if (!placeMatch) continue;
    const place = parseInt(placeMatch[1].trim(), 10);
    if (!Number.isFinite(place)) continue;

    const nameMatch = row.match(/<td class="player">.*?<a [^>]*>([^<]+)<\/a>/);
    const pdgaMatch = row.match(/<td class="pdga-number">(\d+)<\/td>/);
    if (!nameMatch || !pdgaMatch) continue;

    rows.push({
      place,
      pdgaNumber: parseInt(pdgaMatch[1], 10),
      name: nameMatch[1].trim(),
    });
  }
  return rows;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+iii?$/i, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ImportResult = {
  insertedRows: number;
  unmatchedRows: number;
  unmatchedSample: Array<{ event: string; name: string; pdgaNumber: number; division: "MPO" | "FPO" }>;
  events: Array<{
    name: string;
    pdgaId: number;
    tournamentId: number;
    mpoRows: number;
    fpoRows: number;
  }>;
};

/**
 * Refreshes tournament_results by scraping every tournament whose
 * `pdga_event_id` is set on its DB row. The set of tournaments imported is
 * driven by the DB, not a hardcoded list — add a tournament row with a
 * pdga_event_id and it's automatically picked up.
 */
export async function runPdgaImport(supabase: SupabaseClient): Promise<ImportResult> {
  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, name, pdga_event_id")
    .not("pdga_event_id", "is", null);

  const events = (tournaments ?? []).map((t: any) => ({
    dbId: t.id as number,
    pdgaId: t.pdga_event_id as number,
    name: t.name as string,
  }));

  const { data: players } = await supabase
    .from("players")
    .select("id, name, division, pdga_number");
  const byPdga = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const p of players ?? []) {
    if (p.pdga_number) byPdga.set(String(p.pdga_number), p);
    byName.set(normalizeName(p.name), p);
  }

  const rowsToInsert: any[] = [];
  const unmatched: Array<{ event: string; name: string; pdgaNumber: number; division: "MPO" | "FPO" }> = [];
  const eventSummaries: ImportResult["events"] = [];

  for (const event of events) {
    let html: string;
    try {
      html = await fetchEventHtml(event.pdgaId);
    } catch {
      eventSummaries.push({ name: event.name, pdgaId: event.pdgaId, tournamentId: event.dbId, mpoRows: 0, fpoRows: 0 });
      continue;
    }

    const mpo = parseResultsTable(html, "tournament-stats-0");
    const fpo = parseResultsTable(html, "tournament-stats-1");
    eventSummaries.push({
      name: event.name,
      pdgaId: event.pdgaId,
      tournamentId: event.dbId,
      mpoRows: mpo.length,
      fpoRows: fpo.length,
    });

    const sections = [
      { rows: mpo, division: "MPO" as const },
      { rows: fpo, division: "FPO" as const },
    ];

    for (const { rows, division } of sections) {
      for (const r of rows) {
        const player = byPdga.get(String(r.pdgaNumber)) ?? byName.get(normalizeName(r.name));
        if (!player) {
          unmatched.push({ event: event.name, ...r, division });
          continue;
        }
        rowsToInsert.push({
          tournament_id: event.dbId,
          player_id: player.id,
          finishing_position: r.place,
          hot_round_count: 0,
          bogey_free_count: 0,
          ace_count: 0,
          fantasy_points: pointsFor(r.place, division),
        });
      }
    }
  }

  const { error: delErr } = await supabase
    .from("tournament_results")
    .delete()
    .neq("id", -1);
  if (delErr) throw delErr;

  for (let i = 0; i < rowsToInsert.length; i += 500) {
    const chunk = rowsToInsert.slice(i, i + 500);
    const { error } = await supabase.from("tournament_results").insert(chunk);
    if (error) throw error;
  }

  return {
    insertedRows: rowsToInsert.length,
    unmatchedRows: unmatched.length,
    unmatchedSample: unmatched.slice(0, 20),
    events: eventSummaries,
  };
}
