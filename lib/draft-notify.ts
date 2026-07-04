import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";

// Web-push notifications for draft events. Like lib/draft-timer.ts these use the
// admin client and do NO auth checks, so they must NOT live in a "use server"
// file. Callers are the guarded pick actions (makeDraftPick,
// commissionerMakePick, autoPickFromRankings) and the shared timer core
// (runExpiredSnakePick), plus startDraft for the opening pick.

type AdminClient = SupabaseClient;
type Member = { id: number; user_id: string | null; draft_position: number | null; team_name: string | null };

/** "1.4"-style label (round.positionInRound) for an overall pick number. */
function pickLabel(overallPick: number, numTeams: number): string {
  if (numTeams <= 0) return `${overallPick}`;
  const round = Math.ceil(overallPick / numTeams);
  const posInRound = overallPick - (round - 1) * numTeams;
  return `${round}.${posInRound}`;
}

async function loadContext(admin: AdminClient, leagueId: number) {
  const { data: draft } = await admin
    .from("drafts")
    .select("id, status, current_pick, total_rounds, third_round_reversal, type")
    .eq("league_id", leagueId)
    .single();
  const { data: members } = await admin
    .from("league_members")
    .select("id, user_id, draft_position, team_name")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });
  return { draft: draft as any, members: (members ?? []) as Member[] };
}

async function resolveOnClock(admin: AdminClient, draft: any, members: Member[]): Promise<Member | null> {
  const positioned = members.filter((m) => m.draft_position != null);
  if (!draft || draft.status !== "in_progress" || positioned.length === 0) return null;
  // After the final pick, current_pick runs past the last slot — no one is up.
  if (draft.current_pick > draft.total_rounds * positioned.length) return null;
  const { data: ownerRows } = await admin
    .from("current_draft_pick_owners")
    .select("overall_pick, owner_team_id")
    .eq("draft_id", draft.id);
  const ownerId = resolvePickOwnerId(
    draft.current_pick,
    positioned.map((m) => ({ id: m.id, draftPosition: m.draft_position as number })),
    draft.third_round_reversal ?? false,
    buildPickOwnerOverrides(ownerRows as any),
  );
  return members.find((m) => m.id === ownerId) ?? null;
}

/** Push "you're on the clock" to whoever currently owns the live pick. */
export async function notifyOnClock(admin: AdminClient, leagueId: number): Promise<void> {
  const { draft, members } = await loadContext(admin, leagueId);
  const oc = await resolveOnClock(admin, draft, members);
  if (!oc || !oc.user_id) return;
  const n = members.filter((m) => m.draft_position != null).length;
  const label = pickLabel(draft.current_pick, n);
  await sendPushToUser(admin, oc.user_id, {
    title: "You're on the clock",
    body: `Pick ${label} — make your selection`,
    url: `/league/${leagueId}/draft?board=1`,
    tag: `draft-turn-${leagueId}-${draft.current_pick}`,
  });
}

/**
 * After a snake pick lands: push "Pick X.Y — Team picked Player" to everyone
 * following the draft (except the team that just picked and whoever is next up),
 * then push the "you're on the clock" alert to the new on-clock team.
 */
export async function notifyDraftPick(admin: AdminClient, leagueId: number): Promise<void> {
  const { draft, members } = await loadContext(admin, leagueId);
  if (!draft) return;
  const n = members.filter((m) => m.draft_position != null).length;

  // The pick that was just made = the highest pick_number for this draft.
  const { data: lastRows } = await admin
    .from("draft_picks")
    .select("pick_number, team_id, players(name, division)")
    .eq("draft_id", draft.id)
    .order("pick_number", { ascending: false })
    .limit(1);
  const last = (lastRows ?? [])[0] as any;

  const oc = await resolveOnClock(admin, draft, members);
  const onClockUserId = oc?.user_id ?? null;

  if (last) {
    const label = pickLabel(last.pick_number, n);
    const playerName = last.players?.name ?? "a player";
    const picker = members.find((m) => m.id === last.team_id);
    const pickerUserId = picker?.user_id ?? null;
    const teamName = picker?.team_name ?? "A team";

    const recipients = Array.from(
      new Set(
        members
          .map((m) => m.user_id)
          .filter((uid): uid is string => !!uid)
          .filter((uid) => uid !== pickerUserId && uid !== onClockUserId),
      ),
    );
    await Promise.all(
      recipients.map((uid) =>
        sendPushToUser(admin, uid, {
          title: `Pick ${label}`,
          body: `${teamName} picked ${playerName}`,
          url: `/league/${leagueId}/draft?board=1`,
          tag: `draft-pick-${leagueId}-${last.pick_number}`,
        }),
      ),
    );
  }

  // Whoever is up next gets the "on the clock" alert.
  if (draft.status === "in_progress" && oc && onClockUserId) {
    const label = pickLabel(draft.current_pick, n);
    await sendPushToUser(admin, onClockUserId, {
      title: "You're on the clock",
      body: `Pick ${label} — make your selection`,
      url: `/league/${leagueId}/draft?board=1`,
      tag: `draft-turn-${leagueId}-${draft.current_pick}`,
    });
  }
}
