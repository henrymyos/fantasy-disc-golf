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

// Per-round bonus points must match lib/scoring-constants.ts.
const BONUS_POINTS = { hotRound: 10, bogeyFree: 5, ace: 20 } as const;

type RoundBonus = { hot: number; bogey: number; ace: number };

async function fetchRoundJson(pdgaId: number, division: "MPO" | "FPO", round: number): Promise<any | null> {
  const url = `https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=${pdgaId}&Division=${division}&Round=${round}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * For a single event, walks every (division, round) and computes per-PDGA#
 * counts of hot rounds, bogey-free rounds, and aces.
 *
 * - Hot round  = lowest RoundScore in that division+round. Multiple players
 *                can share it; each gets credit.
 * - Bogey-free = no hole's score exceeds par in that round.
 * - Ace        = a hole scored 1 on a par >= 2 hole.
 */
async function computeBonusesForEvent(pdgaId: number): Promise<Map<string, RoundBonus>> {
  const bonus = new Map<string, RoundBonus>();

  for (const division of ["MPO", "FPO"] as const) {
    // Probe rounds 1..6 in parallel (events have 3–4; extras come back empty).
    const roundResponses = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((r) => fetchRoundJson(pdgaId, division, r)),
    );

    for (const data of roundResponses) {
      if (!data?.scores) continue;
      const holesInRound = data.layouts?.[0]?.Holes ?? 18;

      // Only count players who actually completed the round.
      const completed = (data.scores as any[]).filter(
        (s) =>
          typeof s.RoundScore === "number" &&
          Array.isArray(s.HoleScores) &&
          s.HoleScores.length === holesInRound &&
          s.HoleScores.every((h: string) => h !== "" && h != null),
      );
      if (completed.length < 5) continue; // round wasn't played for this division

      const minRound = Math.min(...completed.map((s) => s.RoundScore));

      for (const s of completed) {
        if (!s.PDGANum) continue;
        const key = String(s.PDGANum);
        const entry = bonus.get(key) ?? { hot: 0, bogey: 0, ace: 0 };

        if (s.RoundScore === minRound) entry.hot += 1;

        const pars = String(s.Pars ?? "").split(",").map((n) => Number(n));
        const holes = (s.HoleScores as string[]).map((n) => Number(n));
        let bogeyFree = holes.length > 0;
        for (let i = 0; i < holes.length; i++) {
          if (holes[i] > (pars[i] ?? 99)) { bogeyFree = false; break; }
        }
        if (bogeyFree) entry.bogey += 1;

        for (let i = 0; i < holes.length; i++) {
          if (holes[i] === 1 && (pars[i] ?? 0) >= 2) entry.ace += 1;
        }

        bonus.set(key, entry);
      }
    }
  }

  return bonus;
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

    // Pull per-player hot rounds, bogey-free rounds, and aces for this event.
    const bonusByPdga = await computeBonusesForEvent(event.pdgaId);

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
        const bonus = bonusByPdga.get(String(r.pdgaNumber)) ?? { hot: 0, bogey: 0, ace: 0 };
        const placementPts = pointsFor(r.place, division);
        const bonusPts =
          bonus.hot * BONUS_POINTS.hotRound +
          bonus.bogey * BONUS_POINTS.bogeyFree +
          bonus.ace * BONUS_POINTS.ace;
        rowsToInsert.push({
          tournament_id: event.dbId,
          player_id: player.id,
          finishing_position: r.place,
          hot_round_count: bonus.hot,
          bogey_free_count: bonus.bogey,
          ace_count: bonus.ace,
          fantasy_points: Math.round((placementPts + bonusPts) * 10) / 10,
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
