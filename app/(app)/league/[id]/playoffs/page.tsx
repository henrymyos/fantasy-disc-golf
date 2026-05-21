import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DGPT_2026_SCHEDULE,
  effectiveSelection,
  getPlayoffSlugs,
  PLAYOFF_COUNT,
} from "@/lib/dgpt-2026-schedule";
import { computeAltRecords, getTeamWeeklyTotals } from "@/lib/team-scoring";

type Seed = { id: number; team_name: string; wins: number; losses: number; points: number };

function nextPowerOfTwo(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));
}

export default async function PlayoffsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, current_week, scoring_mode, selected_event_slugs")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const scoringMode = (((league as any).scoring_mode ?? "head_to_head") as
    | "head_to_head"
    | "all_play"
    | "median");

  // Playoff slate is the last N selected events.
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs);
  const playoffSlugs = getPlayoffSlugs(selectedSlugs);
  const playoffEvents = DGPT_2026_SCHEDULE.filter((e) => playoffSlugs.includes(e.slug))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Compute standings — same logic as the league dashboard.
  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id);
  const { data: allMatchups } = await supabase
    .from("matchups")
    .select("team1_id, team2_id, team1_score, team2_score, is_final")
    .eq("league_id", id)
    .eq("is_final", true);

  const winsMap: Record<number, { wins: number; losses: number; points: number }> = {};
  (members ?? []).forEach((m) => { winsMap[m.id] = { wins: 0, losses: 0, points: 0 }; });
  (allMatchups ?? []).forEach((m: any) => {
    if (!winsMap[m.team1_id]) winsMap[m.team1_id] = { wins: 0, losses: 0, points: 0 };
    if (!winsMap[m.team2_id]) winsMap[m.team2_id] = { wins: 0, losses: 0, points: 0 };
    winsMap[m.team1_id].points += Number(m.team1_score);
    winsMap[m.team2_id].points += Number(m.team2_score);
    if (scoringMode === "head_to_head") {
      if (m.team1_score > m.team2_score) {
        winsMap[m.team1_id].wins++;
        winsMap[m.team2_id].losses++;
      } else if (m.team2_score > m.team1_score) {
        winsMap[m.team2_id].wins++;
        winsMap[m.team1_id].losses++;
      }
    }
  });
  if (scoringMode !== "head_to_head") {
    const weeklyTotals = await getTeamWeeklyTotals(supabase, Number(id));
    const alt = computeAltRecords(weeklyTotals, scoringMode);
    for (const [teamId, rec] of alt) {
      if (!winsMap[teamId]) winsMap[teamId] = { wins: 0, losses: 0, points: 0 };
      winsMap[teamId].wins = rec.wins;
      winsMap[teamId].losses = rec.losses;
      if (winsMap[teamId].points === 0) {
        let sum = 0;
        for (const v of (weeklyTotals.get(teamId)?.values() ?? [])) sum += v;
        winsMap[teamId].points = sum;
      }
    }
  }

  const standings: Seed[] = (members ?? [])
    .map((m) => ({ ...m, ...winsMap[m.id] }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);

  // Bracket size: round up the number of playoff events + 1 to next power of two.
  // Top seeds get byes if size > playoffEvents.length + 1.
  // Simplest: pick bracketSize = nextPowerOfTwo(playoffEvents.length + 1)
  // capped at total team count.
  const bracketSize = Math.min(
    Math.max(2, nextPowerOfTwo(Math.max(2, playoffEvents.length + 1))),
    standings.length,
  );
  const seeded = standings.slice(0, bracketSize);

  // Build round 1 matchups: 1 vs N, 2 vs N-1, …
  function buildRound1(seeds: Seed[]): Array<{ a: Seed | null; b: Seed | null }> {
    const out: Array<{ a: Seed | null; b: Seed | null }> = [];
    const top = [...seeds];
    while (top.length > 1) {
      const a = top.shift()!;
      const b = top.pop()!;
      out.push({ a, b });
    }
    if (top.length === 1) out.push({ a: top[0], b: null });
    return out;
  }

  const round1 = buildRound1(seeded);
  const totalRounds = Math.log2(bracketSize);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-white font-bold text-xl">Playoff Bracket</h2>
        <p className="text-gray-500 text-sm mt-1">
          {playoffEvents.length > 0 ? (
            <>
              {playoffEvents.length} event{playoffEvents.length !== 1 ? "s" : ""} ·{" "}
              {playoffEvents.map((e) => e.name).join(" → ")}
            </>
          ) : (
            <>Set up your season schedule to populate the playoffs. Last {PLAYOFF_COUNT} selected events become the bracket.</>
          )}
        </p>
      </div>

      {seeded.length < 2 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">Not enough teams to seed a bracket yet.</p>
        </div>
      ) : (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-white font-semibold">Round 1 · Top {bracketSize} seeds</p>
            <p className="text-gray-500 text-xs">{totalRounds} round{totalRounds !== 1 ? "s" : ""} to a champion</p>
          </div>

          <div className="space-y-3">
            {round1.map((pair, i) => (
              <div key={i} className="bg-[#0f1117] border border-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-xs font-mono w-5">#{standings.indexOf(pair.a!) + 1}</span>
                    <span className="text-white font-medium">{pair.a?.team_name}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{pair.a?.wins}-{pair.a?.losses}</span>
                </div>
                <div className="text-center text-gray-600 text-xs my-1">vs</div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-xs font-mono w-5">
                      {pair.b ? `#${standings.indexOf(pair.b) + 1}` : "—"}
                    </span>
                    <span className="text-white font-medium">{pair.b?.team_name ?? "BYE"}</span>
                  </div>
                  <span className="text-gray-500 text-xs">
                    {pair.b ? `${pair.b.wins}-${pair.b.losses}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-gray-600 text-xs mt-4">
            Each round corresponds to one playoff event. Winners advance based on weekly score during that event.
          </p>
        </div>
      )}

      {standings.length > bracketSize && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-white font-semibold mb-3">Missed the cut</h3>
          <div className="space-y-1">
            {standings.slice(bracketSize).map((t, i) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 px-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs font-mono w-5">#{bracketSize + i + 1}</span>
                  <span className="text-white">{t.team_name}</span>
                </div>
                <span className="text-gray-500 text-xs">{t.wins}-{t.losses}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
