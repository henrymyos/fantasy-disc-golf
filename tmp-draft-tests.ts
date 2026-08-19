import { createClient } from "@supabase/supabase-js";
import { snakeSlot } from "@/lib/snake-order";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";
import { currentNominator } from "@/lib/draft-timer";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

// ── snake order, 6 teams ───────────────────────────────────────────────────
const slots = (n: number, teams: number, trr: boolean) =>
  Array.from({ length: n }, (_, i) => snakeSlot(i + 1, teams, trr).slot);
eq("round 1 runs 1..6", slots(6, 6, false), [1, 2, 3, 4, 5, 6]);
eq("round 2 reverses", slots(12, 6, false).slice(6), [6, 5, 4, 3, 2, 1]);
eq("round 3 forward (no 3RR)", slots(18, 6, false).slice(12), [1, 2, 3, 4, 5, 6]);
eq("round 3 reversed WITH 3RR", slots(18, 6, true).slice(12), [6, 5, 4, 3, 2, 1]);
eq("round 4 forward WITH 3RR", slots(24, 6, true).slice(18), [1, 2, 3, 4, 5, 6]);
eq("every slot used once per round", [...new Set(slots(6, 6, false))].length, 6);

// ── traded pick slots override the snake owner ─────────────────────────────
const members = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 100 + i, draftPosition: i }));
const overrides = buildPickOwnerOverrides([{ overall_pick: 5, owner_team_id: 101 }]);
eq("pick 5 default owner", resolvePickOwnerId(5, members, false, null), 105);
eq("pick 5 traded to team 101", resolvePickOwnerId(5, members, false, overrides), 101);
eq("untraded pick unaffected", resolvePickOwnerId(6, members, false, overrides), 106);
eq("3RR honored in resolve", resolvePickOwnerId(13, members, true, null), 106);

// ── auction nominator rotation ─────────────────────────────────────────────
const am = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 200 + i, draft_position: i }));
eq("nominator pick 1", (currentNominator(am, 1) as any)?.id, 201);
eq("nominator pick 7 (round 2 reverses)", (currentNominator(am, 7) as any)?.id, 206);
eq("nominator pick 13", (currentNominator(am, 13) as any)?.id, 201);

async function main() {
  const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ── the compare-and-swap the timer fixes rely on ──────────────────────────
  const { data: before } = await a.from("pdga_import_state").select("last_run_at").eq("id", 1).single();
  const stamp = (before as any).last_run_at;
  const hit = await a.from("pdga_import_state").update({ last_run_at: stamp }).eq("id", 1).eq("last_run_at", stamp).select("id");
  eq("CAS with matching predicate returns the row", hit.data?.length, 1);
  const miss = await a.from("pdga_import_state").update({ last_run_at: stamp }).eq("id", 1).eq("last_run_at", "1999-01-01T00:00:00Z").select("id");
  eq("CAS with stale predicate returns no rows", miss.data?.length, 0);
  eq("CAS miss is not an error", miss.error, null);
  const isMiss = await a.from("pdga_import_state").update({ last_run_at: stamp }).eq("id", 1).is("last_run_at", null).select("id");
  eq(".is(null) predicate on a set column matches nothing", isMiss.data?.length, 0);
  await a.from("pdga_import_state").update({ last_run_at: stamp }).eq("id", 1); // restore

  // ── import scoping ────────────────────────────────────────────────────────
  const all = await a.from("tournaments").select("id").not("pdga_event_id", "is", null);
  const day = 86400000;
  const from = new Date(Date.now() - 2 * day).toISOString().slice(0, 10);
  const to = new Date(Date.now() + day).toISOString().slice(0, 10);
  const recent = await a.from("tournaments").select("id, name, start_date, end_date")
    .not("pdga_event_id", "is", null).gte("end_date", from).lte("start_date", to);
  console.log(`\nimport scope: all = ${all.data?.length} events (~${((all.data?.length ?? 0) * 3.9).toFixed(0)}s), recent = ${recent.data?.length} events (~${((recent.data?.length ?? 0) * 3.9).toFixed(0)}s)`);
  console.log("recent:", JSON.stringify(recent.data));
  // A live event must be inside the recent window.
  const today = new Date().toISOString().slice(0, 10);
  const live = (all.data ?? []).length > 0
    ? (await a.from("tournaments").select("id,name").lte("start_date", today).gte("end_date", today)).data ?? []
    : [];
  const recentIds = new Set((recent.data ?? []).map((t: any) => t.id));
  eq("every live event is in the recent scope", live.every((t: any) => recentIds.has(t.id)), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
