import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueNotification } from "@/lib/notifications";

// Core waiver helpers. These intentionally live OUTSIDE any "use server" module:
// they use the admin (service-role) client and perform NO auth checks, so
// exporting them from a server-action file would expose them as unauthenticated
// endpoints any logged-in user could invoke against any league. The only
// callers are the guarded actions in actions/rosters.ts (setWaiversLocked,
// processWaivers) and the CRON_SECRET-gated waiver cron.

export type WaiverOrderMode = "reverse_standings" | "reverse_last_add";

/**
 * Recomputes each team's waiver_priority for a new waiver cycle, using the
 * mode configured on the league:
 *   reverse_standings — worst record claims first (ties by lower total points)
 *   reverse_last_add  — team that hasn't added a player in longest gets first
 *                       pick (teams with no add history beat teams that just
 *                       added)
 */
export async function resetWaiverPriority(leagueId: number): Promise<void> {
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("waiver_order_mode")
    .eq("id", leagueId)
    .single();
  const mode = (((league as any)?.waiver_order_mode ?? "reverse_standings") as WaiverOrderMode);

  const { data: members } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId);
  if (!members || members.length === 0) return;

  let ordered: { id: number }[] = [];

  if (mode === "reverse_standings") {
    const wins: Record<number, number> = {};
    const points: Record<number, number> = {};
    members.forEach((m) => { wins[m.id] = 0; points[m.id] = 0; });

    const { data: matchups } = await admin
      .from("matchups")
      .select("team1_id, team2_id, team1_score, team2_score, is_final")
      .eq("league_id", leagueId)
      .eq("is_final", true);

    (matchups ?? []).forEach((m: any) => {
      points[m.team1_id] = (points[m.team1_id] ?? 0) + Number(m.team1_score);
      points[m.team2_id] = (points[m.team2_id] ?? 0) + Number(m.team2_score);
      if (m.team1_score > m.team2_score) wins[m.team1_id] = (wins[m.team1_id] ?? 0) + 1;
      else if (m.team2_score > m.team1_score) wins[m.team2_id] = (wins[m.team2_id] ?? 0) + 1;
    });

    ordered = [...members].sort((a, b) => {
      const wDiff = (wins[a.id] ?? 0) - (wins[b.id] ?? 0);
      if (wDiff !== 0) return wDiff;
      return (points[a.id] ?? 0) - (points[b.id] ?? 0);
    });
  } else if (mode === "reverse_last_add") {
    const { data: adds } = await admin
      .from("roster_transactions")
      .select("team_id, created_at")
      .eq("league_id", leagueId)
      .eq("action", "add")
      .order("created_at", { ascending: false });

    const lastAdd = new Map<number, string>();
    (adds ?? []).forEach((row: any) => {
      if (!lastAdd.has(row.team_id)) lastAdd.set(row.team_id, row.created_at);
    });

    // Teams with no add history get earliest sort key so they go first.
    ordered = [...members].sort((a, b) => {
      const aTs = lastAdd.get(a.id) ?? "";
      const bTs = lastAdd.get(b.id) ?? "";
      if (aTs === bTs) return a.id - b.id;
      return aTs.localeCompare(bTs);
    });
  }

  for (let i = 0; i < ordered.length; i++) {
    await admin
      .from("league_members")
      .update({ waiver_priority: i + 1 })
      .eq("id", ordered[i].id);
  }
}

/** Core waiver-processing routine, shared between the commissioner action and
 *  the scheduled cron. Uses the admin client; no auth checks (see file note). */
export async function runWaiverProcessing(leagueId: number): Promise<void> {
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("roster_size, current_week")
    .eq("id", leagueId)
    .single();
  if (!league) return;

  const { data: claims } = await admin
    .from("waiver_claims")
    .select("id, team_id, player_id, drop_player_id, submitted_at, claim_order, league_members!inner(waiver_priority)")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .order("claim_order", { ascending: true, nullsFirst: false })
    .order("submitted_at", { ascending: true });

  // No claims to grant — but still unlock (the final step below) so free
  // agency reopens. Returning before the unlock left claim-less leagues
  // locked forever.
  if (!claims || claims.length === 0) {
    await admin.from("leagues").update({ waivers_locked: false }).eq("id", leagueId);
    return;
  }

  // Group claims by team, sorted by team waiver priority, then the member's
  // chosen claim order (first listed is attempted first).
  const byTeam = new Map<number, any[]>();
  for (const c of claims) {
    const list = byTeam.get(c.team_id) ?? [];
    list.push(c);
    byTeam.set(c.team_id, list);
  }
  const teamsByPriority = [...byTeam.keys()].sort((a, b) => {
    const aP = (byTeam.get(a)![0] as any).league_members?.waiver_priority ?? 9999;
    const bP = (byTeam.get(b)![0] as any).league_members?.waiver_priority ?? 9999;
    return aP - bP;
  });

  const grantedTeams: number[] = [];

  for (const teamId of teamsByPriority) {
    const teamClaims = byTeam.get(teamId)!;
    let granted = false;
    for (const claim of teamClaims) {
      if (granted) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      // Player must still be unrostered.
      const { data: stillFA } = await admin
        .from("rosters")
        .select("id")
        .eq("league_id", leagueId)
        .eq("player_id", claim.player_id)
        .maybeSingle();
      if (stillFA) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      const { count } = await admin
        .from("rosters")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("team_id", teamId);
      const rosterCount = count ?? 0;
      const needsDrop = rosterCount >= (league as any).roster_size;

      if (needsDrop && !claim.drop_player_id) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      // If a drop is attached and we need the room, make sure it's actually on
      // the roster; a stale drop must fail the claim, not add over the cap.
      if (claim.drop_player_id) {
        const { data: dropSpot } = await admin
          .from("rosters")
          .select("id")
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", claim.drop_player_id)
          .maybeSingle();
        if (needsDrop && !dropSpot) {
          await admin
            .from("waiver_claims")
            .update({ status: "failed", processed_at: new Date().toISOString() })
            .eq("id", claim.id);
          continue;
        }
      }

      // Add first so a failed insert (player grabbed between checks) doesn't
      // drop a player for nothing.
      const { error: addErr } = await admin.from("rosters").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: claim.player_id,
        acquired_week: (league as any).current_week,
      });
      if (addErr) {
        await admin
          .from("waiver_claims")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", claim.id);
        continue;
      }

      if (claim.drop_player_id) {
        await admin
          .from("rosters")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", claim.drop_player_id);
      }

      await admin.from("roster_transactions").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: claim.player_id,
        action: "add",
        dropped_player_id: claim.drop_player_id ?? null,
      });

      await admin
        .from("waiver_claims")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", claim.id);

      granted = true;
      grantedTeams.push(teamId);
    }
  }

  // Push every team that won a claim to the back of the waiver queue.
  if (grantedTeams.length > 0) {
    const { data: allMembers } = await admin
      .from("league_members")
      .select("id, waiver_priority")
      .eq("league_id", leagueId);
    const ordered = [...(allMembers ?? [])].sort(
      (a, b) => ((a as any).waiver_priority ?? 9999) - ((b as any).waiver_priority ?? 9999),
    );
    const grantedSet = new Set(grantedTeams);
    const losers = ordered.filter((m) => !grantedSet.has(m.id));
    const winners = ordered.filter((m) => grantedSet.has(m.id));
    const reordered = [...losers, ...winners];
    for (let i = 0; i < reordered.length; i++) {
      await admin
        .from("league_members")
        .update({ waiver_priority: i + 1 })
        .eq("id", reordered[i].id);
    }
  }

  // Notify each team of their waiver outcome (best-effort). One message per
  // team: their win if they got one, otherwise that a claim didn't go through.
  try {
    const claimIds = claims.map((c: any) => c.id);
    const { data: outcomes } = await admin
      .from("waiver_claims")
      .select("team_id, status, players(name)")
      .in("id", claimIds);
    const byTeam = new Map<number, { won?: string; lost?: string }>();
    for (const o of outcomes ?? []) {
      const t = (o as any).team_id;
      const name = (o as any).players?.name ?? "a player";
      const cur = byTeam.get(t) ?? {};
      if ((o as any).status === "processed") cur.won = name;
      else if (!cur.lost) cur.lost = name;
      byTeam.set(t, cur);
    }
    const { data: teamRows } = await admin
      .from("league_members")
      .select("id, user_id")
      .in("id", [...byTeam.keys()]);
    const userByTeam = new Map<number, string | null>();
    for (const r of teamRows ?? []) userByTeam.set((r as any).id, (r as any).user_id);
    for (const [teamId, oc] of byTeam) {
      const uid = userByTeam.get(teamId);
      if (!uid) continue;
      const body = oc.won
        ? `You won ${oc.won} on waivers.`
        : `Your waiver claim for ${oc.lost ?? "a player"} didn't go through.`;
      await enqueueNotification(admin, {
        userId: uid,
        leagueId,
        kind: "waiver_result",
        body,
        link: `/league/${leagueId}/free-agency`,
      });
    }
  } catch (e) {
    console.warn("waiver result notify failed", e);
  }

  // Auto-unlock waivers so free agency reopens.
  await admin.from("leagues").update({ waivers_locked: false }).eq("id", leagueId);
}
