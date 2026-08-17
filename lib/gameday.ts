// Post-import "gameday" pass, run right after a PDGA score refresh while a
// tournament is live. For every league whose schedule includes the live event
// it (1) snapshots each open matchup's actual scores + win probability into
// matchup_prob_snapshots (fuel for the win-probability chart), (2) sends a
// lead-change notification when a matchup's leader flips between refreshes,
// and (3) sends hot-round notifications to owners of players who just carded
// one. Everything here is best-effort: a failure must never break the score
// import that triggered it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLeagueSchedule } from "@/lib/league-schedule";
import { buildWeekProjections } from "@/lib/matchup-projections";
import { enqueueNotification } from "@/lib/notifications";
import type { LiveDelta } from "@/lib/pdga-import";

// Don't pile up a snapshot every poll — one every ~2.5 min is plenty for the
// chart. Lead changes bypass this so the flip itself is always recorded.
const SNAPSHOT_MIN_AGE_MS = 150_000;

export async function runGamedayPass(
  admin: SupabaseClient,
  liveDeltas: LiveDelta[] = [],
): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: liveRows } = await admin
      .from("tournaments")
      .select("id, name, start_date, end_date, lock_at, registered_player_ids")
      .lte("start_date", today)
      .gte("end_date", today)
      .order("start_date", { ascending: true });
    // Same start gate as getActiveTournament: not live until round-1 tee-off.
    const liveTournaments = (liveRows ?? []).filter((t: any) => {
      if (!t.lock_at) return true;
      const lockMs = Date.parse(t.lock_at);
      return !Number.isFinite(lockMs) || Date.now() >= lockMs;
    });
    if (liveTournaments.length === 0) return;

    // Player names for hot-round notification bodies.
    const hotDeltas = liveDeltas.filter((d) => d.hot > 0);
    const nameByPlayer = new Map<number, string>();
    if (hotDeltas.length > 0) {
      const { data: players } = await admin
        .from("players")
        .select("id, name")
        .in("id", [...new Set(hotDeltas.map((d) => d.playerId))]);
      (players ?? []).forEach((p: any) => nameByPlayer.set(p.id, p.name));
    }

      const { data: leagues } = await admin
      .from("leagues")
      .select("id, scoring_rules, mpo_starters, fpo_starters");

    for (const league of leagues ?? []) {
      try {
        await runLeaguePass(admin, league, liveTournaments as any[], hotDeltas, nameByPlayer);
      } catch (e) {
        console.warn(`gameday pass failed for league ${league.id}`, e);
      }
    }
  } catch (e) {
    console.warn("gameday pass failed", e);
  }
}

async function runLeaguePass(
  admin: SupabaseClient,
  league: { id: number; scoring_rules: unknown; mpo_starters?: number | null; fpo_starters?: number | null },
  liveTournaments: Array<{ id: number; name: string; lock_at: string | null; start_date: string; end_date: string; registered_player_ids: number[] | null }>,
  hotDeltas: LiveDelta[],
  nameByPlayer: Map<number, string>,
): Promise<void> {
  const schedule = await getLeagueSchedule(admin, league.id);
  if (!schedule) return;
  const liveT = liveTournaments.find((t) => schedule.tournamentIdToWeek.has(t.id));
  if (!liveT) return; // league is off this week
  const week = schedule.tournamentIdToWeek.get(liveT.id)!;
  const weekIds = schedule.weekToTournamentIds.get(week) ?? [liveT.id];

  const { data: roster } = await admin
    .from("rosters")
    .select("team_id, player_id, is_starter")
    .eq("league_id", league.id);
  const rosterRows = (roster ?? []) as Array<{ team_id: number; player_id: number; is_starter: boolean }>;
  if (rosterRows.length === 0) return;

  // Hot-round notifications: any owner of the player in this league.
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, team_name")
    .eq("league_id", league.id);
  const memberById = new Map<number, { user_id: string; team_name: string }>(
    (members ?? []).map((m: any) => [m.id as number, m]),
  );
  const weekIdSet = new Set(weekIds);
  const notified = new Set<string>();
  for (const d of hotDeltas) {
    if (!weekIdSet.has(d.tournamentId)) continue;
    const playerName = nameByPlayer.get(d.playerId);
    if (!playerName) continue;
    for (const r of rosterRows) {
      if (r.player_id !== d.playerId) continue;
      const owner = memberById.get(r.team_id);
      if (!owner?.user_id) continue;
      const key = `${owner.user_id}:${d.playerId}`;
      if (notified.has(key)) continue;
      notified.add(key);
      await enqueueNotification(admin, {
        userId: owner.user_id,
        leagueId: league.id,
        kind: "hot_round",
        body: `${playerName} just carded the hot round at ${liveT.name}! 🔥`,
        link: `/league/${league.id}/matchup`,
      });
    }
  }

  // ---- Matchup snapshots + lead-change alerts ----
  const { data: matchups } = await admin
    .from("matchups")
    .select(`
      id, week, team1_id, team2_id, is_final,
      team1:league_members!matchups_team1_id_fkey(user_id, team_name),
      team2:league_members!matchups_team2_id_fkey(user_id, team_name)
    `)
    .eq("league_id", league.id)
    .eq("week", week)
    .eq("is_final", false);
  if (!matchups || matchups.length === 0) return;

  // Snapshot exactly what the matchup pages show: same scoring rules, same
  // starter slots, same pace math — otherwise the win-probability chart drifts
  // away from the live win bar drawn above it.
  const wk = await buildWeekProjections(admin, {
    leagueId: league.id,
    week,
    schedule,
    league,
  });

  for (const m of matchups as any[]) {
    const t1 = wk.teamNumbers(m.team1_id);
    const t2 = wk.teamNumbers(m.team2_id);
    const t1WinPct = wk.winPctFor(m.team1_id, m.team2_id);

    const { data: prev } = await admin
      .from("matchup_prob_snapshots")
      .select("t1_score, t2_score, created_at")
      .eq("matchup_id", m.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let leadChanged = false;
    if (prev) {
      const prevLeader = Math.sign(Number(prev.t1_score) - Number(prev.t2_score));
      const curLeader = Math.sign(t1.actual - t2.actual);
      leadChanged = prevLeader !== 0 && curLeader !== 0 && prevLeader !== curLeader;
    }

    const prevAge = prev ? Date.now() - Date.parse(prev.created_at) : Infinity;
    if (leadChanged || prevAge >= SNAPSHOT_MIN_AGE_MS) {
      await admin.from("matchup_prob_snapshots").insert({
        matchup_id: m.id,
        league_id: league.id,
        t1_score: t1.actual,
        t2_score: t2.actual,
        t1_win_pct: t1WinPct,
      });
    }

    if (leadChanged) {
      const leader = t1.actual > t2.actual
        ? { name: m.team1?.team_name, pts: t1.actual, trailing: m.team2?.team_name, trailingPts: t2.actual }
        : { name: m.team2?.team_name, pts: t2.actual, trailing: m.team1?.team_name, trailingPts: t1.actual };
      const body = `Lead change! ${leader.name} (${leader.pts.toFixed(1)}) just passed ${leader.trailing} (${leader.trailingPts.toFixed(1)}) at ${liveT.name}.`;
      for (const uid of [m.team1?.user_id, m.team2?.user_id]) {
        if (!uid) continue;
        await enqueueNotification(admin, {
          userId: uid,
          leagueId: league.id,
          kind: "lead_change",
          body,
          link: `/league/${league.id}/matchups/${m.id}`,
        });
      }
    }
  }
}

/** Human line for one live feed row; used by the matchup live ticker. */
export function describeFeedEvent(
  kind: string,
  detail: Record<string, unknown>,
): string {
  const posTo = detail.pos_to as number | null;
  const posFrom = detail.pos_from as number | null;
  const place = (n: number) => {
    const s = ["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][n % 100] ?? "th";
    return `${n}${s}`;
  };
  const pos = posTo != null ? ` — ${place(posTo)}` : "";
  switch (kind) {
    case "ace":
      return `ACE! Threw an ace${pos}`;
    case "hot_round":
      return `Carded the hot round${pos}`;
    case "eagle": {
      const n = Number(detail.eagle ?? 1);
      return `${n > 1 ? `${n} eagles` : "Eagle"}${pos}`;
    }
    case "bogey_free":
      return `Finished a bogey-free round${pos}`;
    case "birdies": {
      const n = Number(detail.birdies ?? 0);
      return `+${n} under-par ${n === 1 ? "stroke" : "strokes"}${pos}`;
    }
    case "position":
      return posFrom != null && posTo != null
        ? posTo < posFrom
          ? `Moved up ${place(posFrom)} → ${place(posTo)}`
          : `Dropped ${place(posFrom)} → ${place(posTo)}`
        : `Now in ${posTo != null ? place(posTo) : "the field"}`;
    default:
      return detail.is_new ? `On the card${pos}` : `Posted a score${pos}`;
  }
}
