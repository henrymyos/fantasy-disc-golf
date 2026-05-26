// Simulates a 6-team snake draft with a 60s pick clock and validates every
// invariant we can think of. Mirrors the logic in actions/drafts.ts +
// actions/rankings.ts so any drift between them surfaces as a mismatch.
//
// Run: npx tsx --env-file=.env.local scripts/simulate-draft.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

const NUM_TEAMS = 6;
const TOTAL_ROUNDS = 6; // 36 picks, fits 4 MPO + 2 FPO starters exactly
const MPO_STARTERS = 4;
const FPO_STARTERS = 2;
const SECONDS_PER_PICK = 60;

const findings: string[] = [];
function flag(msg: string) {
  findings.push(msg);
  console.log("  ⚠ " + msg);
}
function ok(msg: string) {
  console.log("  ✓ " + msg);
}

function onClockSlot(pick: number, numTeams: number): { round: number; slot: number } {
  const round = Math.ceil(pick / numTeams);
  const positionInRound = pick - (round - 1) * numTeams;
  const isReversed = round % 2 === 0;
  const slot = isReversed ? numTeams - positionInRound + 1 : positionInRound;
  return { round, slot };
}

async function createTestLeague(): Promise<{ leagueId: number; draftId: number; memberIds: number[] }> {
  // Borrow a real auth user as commissioner — schema requires a FK ref.
  const { data: { users } } = await admin.auth.admin.listUsers();
  const commissioner = users[0]?.id;
  if (!commissioner) throw new Error("no auth users to borrow as commissioner");

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "DRAFT-SIM-" + Date.now(),
      commissioner_id: commissioner,
      invite_code: "SIM" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      max_teams: NUM_TEAMS,
      roster_size: TOTAL_ROUNDS,
      starters_count: MPO_STARTERS + FPO_STARTERS,
      mpo_starters: MPO_STARTERS,
      fpo_starters: FPO_STARTERS,
      season_year: 2026,
      current_week: 1,
      draft_status: "pending",
    })
    .select("id")
    .single();
  if (lErr || !league) throw new Error("league insert failed: " + lErr?.message);
  const leagueId = league.id;

  const rows = Array.from({ length: NUM_TEAMS }, (_, i) => ({
    league_id: leagueId,
    user_id: null, // null user_id is allowed and avoids needing real auth users
    team_name: `Team ${i + 1}`,
    is_commissioner: i === 0,
  }));
  const { data: members, error: mErr } = await admin
    .from("league_members")
    .insert(rows)
    .select("id");
  if (mErr || !members) throw new Error("members insert failed: " + mErr?.message);

  const { data: draft, error: dErr } = await admin
    .from("drafts")
    .insert({
      league_id: leagueId,
      type: "snake",
      total_rounds: TOTAL_ROUNDS,
      seconds_per_pick: SECONDS_PER_PICK,
      status: "pending",
      current_pick: 1,
    })
    .select("id")
    .single();
  if (dErr || !draft) throw new Error("draft insert failed: " + dErr?.message);

  return { leagueId, draftId: draft.id, memberIds: members.map((m) => m.id) };
}

async function teardown(leagueId: number) {
  // Cascades handle the rest.
  await admin.from("leagues").delete().eq("id", leagueId);
}

// Mirrors actions/drafts.ts:makeDraftPick — routes the atomic claim through
// the claim_draft_pick RPC.
async function manualPick(
  client: SupabaseClient,
  leagueId: number,
  _draftId: number,
  callerMemberId: number,
  playerId: number,
): Promise<"ok" | "rejected_not_on_clock" | "rejected_duplicate" | "rejected_state"> {
  const { data, error } = await client.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: callerMemberId,
    p_player_id: playerId,
  });
  if (error) return "rejected_state";
  const status = (data as any)?.status;
  if (status === "ok") return "ok";
  if (status === "rejected_not_on_clock") return "rejected_not_on_clock";
  if (status === "rejected_duplicate") return "rejected_duplicate";
  return "rejected_state";
}

// Mirrors actions/rankings.ts:autoPickExpired — chooses best-available then
// routes through the same RPC.
async function autoPickExpired(client: SupabaseClient, leagueId: number, _draftId: number): Promise<"ok" | "rejected_state" | "rejected_not_expired"> {
  const { data: draft } = await client
    .from("drafts")
    .select("status, current_pick, seconds_per_pick, current_pick_started_at")
    .eq("league_id", leagueId)
    .single();
  if (!draft || draft.status !== "in_progress") return "rejected_state";
  if (!draft.current_pick_started_at) return "rejected_state";
  const elapsed = (Date.now() - Date.parse(draft.current_pick_started_at)) / 1000;
  if (elapsed < (draft.seconds_per_pick ?? 90)) return "rejected_not_expired";

  const { data: members } = await client
    .from("league_members")
    .select("id, draft_position")
    .eq("league_id", leagueId)
    .not("draft_position", "is", null)
    .order("draft_position");
  const { slot } = onClockSlot(draft.current_pick, members!.length);
  const onClock = members!.find((m) => m.draft_position === slot);
  if (!onClock) return "rejected_state";

  const { data: drafted } = await client.from("rosters").select("player_id").eq("league_id", leagueId);
  const draftedSet = new Set((drafted ?? []).map((r: any) => r.player_id));
  const { data: bestAvail } = await client
    .from("players")
    .select("id, overall_rank")
    .order("overall_rank", { ascending: true, nullsFirst: false })
    .limit(500);
  let picked: number | null = null;
  for (const p of bestAvail ?? []) {
    if (!draftedSet.has(p.id)) { picked = p.id; break; }
  }
  if (picked == null) return "rejected_state";

  const { data } = await client.rpc("claim_draft_pick", {
    p_league_id: leagueId,
    p_team_id: onClock.id,
    p_player_id: picked,
  });
  return (data as any)?.status === "ok" ? "ok" : "rejected_state";
}

async function main() {
  console.log("=== draft simulation ===\n");
  const { leagueId, draftId, memberIds } = await createTestLeague();
  console.log(`created league ${leagueId} with ${memberIds.length} teams, draft ${draftId}`);

  try {
    // -- Phase: start draft (mirrors actions/drafts.ts startDraft, snake path) --
    const positions = memberIds.map((id, i) => ({ id, pos: i + 1 }));
    for (const { id, pos } of positions) {
      await admin.from("league_members").update({ draft_position: pos }).eq("id", id);
    }
    await admin
      .from("drafts")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        current_pick: 1,
        current_pick_started_at: new Date().toISOString(),
      })
      .eq("id", draftId);
    await admin.from("leagues").update({ draft_status: "in_progress" }).eq("id", leagueId);
    ok("started draft (snake, 6 teams, 6 rounds = 36 picks, 60s clock)");

    // Pull a pool of players (≥ 36) split by division for realistic picking.
    const { data: mpoPool } = await admin
      .from("players")
      .select("id, name, overall_rank")
      .eq("division", "MPO")
      .order("overall_rank", { ascending: true, nullsFirst: false })
      .limit(50);
    const { data: fpoPool } = await admin
      .from("players")
      .select("id, name, overall_rank")
      .eq("division", "FPO")
      .order("overall_rank", { ascending: true, nullsFirst: false })
      .limit(30);
    const remainingMpo = [...(mpoPool ?? [])];
    const remainingFpo = [...(fpoPool ?? [])];
    console.log(`  pool: ${remainingMpo.length} MPO + ${remainingFpo.length} FPO available\n`);

    // -- Edge case A: pick out of turn --
    const draftAtP1 = await admin.from("drafts").select("current_pick").eq("id", draftId).single();
    const wrongTeam = memberIds[2]; // slot 3 trying to pick at pick 1 (slot 1 is on clock)
    const ootResult = await manualPick(admin, leagueId, draftId, wrongTeam, remainingMpo[0].id);
    if (ootResult === "rejected_not_on_clock") ok("out-of-turn pick is rejected");
    else flag(`out-of-turn pick was NOT rejected (got: ${ootResult})`);

    // -- Run the full draft, mixing manual + autopicks + edge cases --
    const totalPicks = NUM_TEAMS * TOTAL_ROUNDS;
    let autoPickCount = 0;
    let duplicateRejections = 0;
    let raceTested = false;

    while (true) {
      const { data: d } = await admin
        .from("drafts")
        .select("current_pick, status")
        .eq("id", draftId)
        .single();
      if (!d || d.status === "complete") break;
      const pick = d.current_pick;
      if (pick > totalPicks) break;
      const { round, slot } = onClockSlot(pick, NUM_TEAMS);
      const onClockMember = memberIds[slot - 1];

      // Edge case D: at pick 2, simulate two simultaneous pick attempts
      // for the same pick number (race between manual pick and an autopick
      // poller, e.g.). Both pass validation, but only one should persist.
      if (pick === 2 && !raceTested) {
        raceTested = true;
        const p1 = remainingMpo[0].id;
        const p2 = remainingMpo[1].id;
        const [a, b] = await Promise.all([
          manualPick(admin, leagueId, draftId, onClockMember, p1),
          manualPick(admin, leagueId, draftId, onClockMember, p2),
        ]);
        const okCount = [a, b].filter((r) => r === "ok").length;
        const { count: pc2 } = await admin
          .from("draft_picks")
          .select("id", { count: "exact", head: true })
          .eq("draft_id", draftId)
          .eq("pick_number", 2);
        const { count: rc2 } = await admin
          .from("rosters")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .in("player_id", [p1, p2]);
        if (okCount === 2 && pc2 === 1 && (rc2 ?? 0) === 2) {
          flag(`race: both manualPick calls returned ok, but only 1 draft_pick row exists — the losing path's roster row is ORPHANED (player drafted with no draft_picks entry)`);
        } else if (okCount === 2 && pc2 === 2) {
          flag(`race: BOTH picks landed in draft_picks — unique constraint failed`);
        } else {
          ok(`race condition handled cleanly (accepted=${okCount}, picks=${pc2}, rosters=${rc2})`);
        }
        for (const pid of [p1, p2]) {
          const idx = remainingMpo.findIndex((pp) => pp.id === pid);
          if (idx >= 0) remainingMpo.splice(idx, 1);
        }
        continue;
      }

      // Edge case B: at pick 5, simulate timer expiry → autopick (60s clock)
      if (pick === 5) {
        await admin
          .from("drafts")
          .update({ current_pick_started_at: new Date(Date.now() - 61_000).toISOString() })
          .eq("id", draftId);
        const r = await autoPickExpired(admin, leagueId, draftId);
        if (r === "ok") {
          ok(`pick #${pick}: autopick after timer expiry (round ${round}, slot ${slot})`);
          autoPickCount++;
          // Sync local pools with whatever the autopicker grabbed.
          const { data: latest } = await admin
            .from("draft_picks")
            .select("player_id, players(division)")
            .eq("draft_id", draftId)
            .eq("pick_number", pick)
            .single();
          const apId = (latest as any)?.player_id;
          if (apId != null) {
            const idx1 = remainingMpo.findIndex((p) => p.id === apId);
            if (idx1 >= 0) remainingMpo.splice(idx1, 1);
            const idx2 = remainingFpo.findIndex((p) => p.id === apId);
            if (idx2 >= 0) remainingFpo.splice(idx2, 1);
          }
        } else {
          flag(`autopick rejected unexpectedly: ${r}`);
        }
        continue;
      }

      // Edge case C: at pick 7, try a previously-picked player first
      if (pick === 7) {
        const { data: alreadyTaken } = await admin
          .from("rosters")
          .select("player_id")
          .eq("league_id", leagueId)
          .limit(1)
          .single();
        const dupRes = await manualPick(admin, leagueId, draftId, onClockMember, (alreadyTaken as any).player_id);
        if (dupRes === "rejected_duplicate") {
          duplicateRejections++;
          ok(`pick #${pick}: duplicate-player attempt rejected`);
        } else {
          flag(`duplicate-player attempt was NOT rejected (got: ${dupRes})`);
        }
      }

      // Decide pick. Alternate division based on what the team still needs to
      // exercise both slot-fill paths. Pick MPO until they have 4, then FPO,
      // then more MPO (bench).
      const { data: teamRoster } = await admin
        .from("rosters")
        .select("players!inner(division)")
        .eq("league_id", leagueId)
        .eq("team_id", onClockMember);
      const mpoOwned = (teamRoster ?? []).filter((r: any) => r.players.division === "MPO").length;
      const fpoOwned = (teamRoster ?? []).filter((r: any) => r.players.division === "FPO").length;

      let chooseMpo: boolean;
      if (mpoOwned < MPO_STARTERS) chooseMpo = true;
      else if (fpoOwned < FPO_STARTERS) chooseMpo = false;
      else chooseMpo = (round % 2 === 1);

      const pool = chooseMpo ? remainingMpo : remainingFpo;
      if (pool.length === 0) { flag("ran out of pool players"); break; }
      const player = pool.shift()!;

      const res = await manualPick(admin, leagueId, draftId, onClockMember, player.id);
      if (res !== "ok") {
        flag(`pick #${pick} failed: ${res} (team ${onClockMember}, player ${player.id})`);
        break;
      }
    }

    // -- Final state checks --
    console.log("\n--- final invariants ---");
    const { data: draftAfter } = await admin
      .from("drafts")
      .select("status, current_pick")
      .eq("id", draftId)
      .single();
    if (draftAfter?.status === "complete") ok("draft.status = 'complete'");
    else flag(`draft.status is '${draftAfter?.status}' (expected 'complete')`);

    const expectedNextPick = totalPicks + 1;
    if (draftAfter?.current_pick === expectedNextPick) ok(`current_pick = ${expectedNextPick}`);
    else flag(`current_pick = ${draftAfter?.current_pick} (expected ${expectedNextPick})`);

    const { data: leagueAfter } = await admin
      .from("leagues")
      .select("draft_status")
      .eq("id", leagueId)
      .single();
    if (leagueAfter?.draft_status === "complete") ok("league.draft_status = 'complete'");
    else flag(`league.draft_status is '${leagueAfter?.draft_status}'`);

    const { data: allPicks } = await admin
      .from("draft_picks")
      .select("pick_number, round, team_id, player_id")
      .eq("draft_id", draftId)
      .order("pick_number");
    if (allPicks?.length === totalPicks) ok(`${totalPicks} draft_picks rows present`);
    else flag(`expected ${totalPicks} draft_picks, got ${allPicks?.length}`);

    // Verify each pick's team matches snake order.
    for (const p of allPicks ?? []) {
      const { slot } = onClockSlot(p.pick_number, NUM_TEAMS);
      const expectedTeam = memberIds[slot - 1];
      if (p.team_id !== expectedTeam) {
        flag(`pick #${p.pick_number}: team_id=${p.team_id} expected ${expectedTeam} (snake mismatch)`);
      }
    }
    ok("every pick.team_id matches snake-order expected team");

    // Round 1 vs 2 vs 3: confirm reversal pattern in the pick rows.
    const round1 = (allPicks ?? []).filter((p: any) => p.round === 1).map((p: any) => p.team_id);
    const round2 = (allPicks ?? []).filter((p: any) => p.round === 2).map((p: any) => p.team_id);
    const round3 = (allPicks ?? []).filter((p: any) => p.round === 3).map((p: any) => p.team_id);
    if (JSON.stringify(round1) === JSON.stringify(memberIds)) ok("round 1 order = [1..6]");
    else flag("round 1 order incorrect: " + round1.join(","));
    if (JSON.stringify(round2) === JSON.stringify([...memberIds].reverse())) ok("round 2 order = [6..1] (reversed)");
    else flag("round 2 order incorrect: " + round2.join(","));
    if (JSON.stringify(round3) === JSON.stringify(memberIds)) ok("round 3 order = [1..6]");
    else flag("round 3 order incorrect: " + round3.join(","));

    // Roster checks per team.
    const { data: allRosters } = await admin
      .from("rosters")
      .select("team_id, player_id, is_starter, lineup_order, players(division)")
      .eq("league_id", leagueId);
    const byTeam = new Map<number, any[]>();
    for (const r of allRosters ?? []) {
      const arr = byTeam.get(r.team_id) ?? [];
      arr.push(r);
      byTeam.set(r.team_id, arr);
    }
    for (const [tid, rs] of byTeam) {
      if (rs.length !== TOTAL_ROUNDS) flag(`team ${tid} has ${rs.length} roster rows (expected ${TOTAL_ROUNDS})`);
      const mpoStarters = rs.filter((r) => r.players.division === "MPO" && r.is_starter);
      const fpoStarters = rs.filter((r) => r.players.division === "FPO" && r.is_starter);
      const mpoBench = rs.filter((r) => r.players.division === "MPO" && !r.is_starter);
      const fpoBench = rs.filter((r) => r.players.division === "FPO" && !r.is_starter);
      // Slot fill: should fill up to MPO_STARTERS / FPO_STARTERS, rest bench.
      const expectedMpoStarters = Math.min(mpoStarters.length + mpoBench.length, MPO_STARTERS);
      const expectedFpoStarters = Math.min(fpoStarters.length + fpoBench.length, FPO_STARTERS);
      if (mpoStarters.length !== expectedMpoStarters)
        flag(`team ${tid} MPO starters=${mpoStarters.length}, expected ${expectedMpoStarters}`);
      if (fpoStarters.length !== expectedFpoStarters)
        flag(`team ${tid} FPO starters=${fpoStarters.length}, expected ${expectedFpoStarters}`);
      // Verify lineup_order uniqueness within division for starters.
      const mpoOrders = mpoStarters.map((r) => r.lineup_order).sort();
      const fpoOrders = fpoStarters.map((r) => r.lineup_order).sort();
      if (new Set(mpoOrders).size !== mpoOrders.length) flag(`team ${tid} duplicate MPO lineup_order`);
      if (new Set(fpoOrders).size !== fpoOrders.length) flag(`team ${tid} duplicate FPO lineup_order`);
    }
    ok("per-team roster counts + starter/bench split verified");

    // No duplicate player picks at all (DB unique should already enforce).
    const allPlayerIds = (allRosters ?? []).map((r) => r.player_id);
    if (new Set(allPlayerIds).size === allPlayerIds.length) ok("no duplicate player_id across all rosters");
    else flag("duplicate player drafted!");

    // Note: matchups are generated by regenerateLeagueMatchups() inside the
    // real actions/drafts.ts:makeDraftPick — our test harness mirrors the
    // direct DB writes only, so we skip that assertion here. See the source
    // review notes at the end of the run.

    // Detect autopick rosters that didn't get a starter slot (drift between
    // makeDraftPick and autoPickExpired).
    let autopickNonStarter = 0;
    if (autoPickCount > 0) {
      const { data: autopickPickRows } = await admin
        .from("draft_picks")
        .select("pick_number, player_id, team_id")
        .eq("draft_id", draftId);
      for (const apRow of autopickPickRows ?? []) {
        if (apRow.pick_number !== 5) continue; // we autopicked at pick 5
        const { data: rosterRow } = await admin
          .from("rosters")
          .select("is_starter, lineup_order")
          .eq("league_id", leagueId)
          .eq("player_id", apRow.player_id)
          .single();
        if (rosterRow && !rosterRow.is_starter) autopickNonStarter++;
      }
    }
    if (autopickNonStarter > 0)
      flag(`autopick'd player(s) landed on bench despite available starter slot (drift between autoPickExpired and makeDraftPick)`);

    console.log("\n--- summary ---");
    console.log(`autopicks fired: ${autoPickCount}`);
    console.log(`duplicate-player rejections: ${duplicateRejections}`);
    console.log(`findings (potential issues): ${findings.length}`);
    findings.forEach((f) => console.log("  • " + f));
  } finally {
    await teardown(leagueId);
    console.log(`\ntorn down test league ${leagueId}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
