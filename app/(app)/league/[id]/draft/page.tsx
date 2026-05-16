import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DraftBoard } from "@/components/draft-board";
import { DraftScheduleForm } from "@/components/draft-schedule-form";
import { randomizeDraftOrder } from "@/actions/drafts";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, draft_status, mpo_starters, fpo_starters, roster_size")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const mpoSlots: number = (league as any).mpo_starters ?? 4;
  const fpoSlots: number = (league as any).fpo_starters ?? 2;
  const rosterSize: number = (league as any).roster_size ?? 14;

  const isCommissioner = league.commissioner_id === user.id;

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick, total_rounds, scheduled_at")
    .eq("league_id", id)
    .single();

  // All members for the pre-draft commissioner panel (some may not have a
  // draft_position yet).
  const { data: allMemberRows } = await supabase
    .from("league_members")
    .select("id, team_name, draft_position, joined_at")
    .eq("league_id", id)
    .order("draft_position", { ascending: true, nullsFirst: false })
    .order("joined_at", { ascending: true });

  // Pre-draft we want to show the board for everyone, even before the order
  // has been randomized. Pull every member and fall back to "Team N"
  // placeholders if their slot hasn't been assigned yet.
  const { data: memberRowsRaw } = await supabase
    .from("league_members")
    .select("id, team_name, draft_position, joined_at")
    .eq("league_id", id)
    .order("draft_position", { ascending: true, nullsFirst: false })
    .order("joined_at", { ascending: true });

  const orderSet = (memberRowsRaw ?? []).every((m: any) => m.draft_position != null);
  const memberRows = (memberRowsRaw ?? []).map((m: any, i: number) => ({
    id: m.id,
    team_name: orderSet ? m.team_name : `Team ${i + 1}`,
    draft_position: orderSet ? m.draft_position : i + 1,
  }));

  const { data: myMemberRow } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  const { data: pickRows } = await supabase
    .from("draft_picks")
    .select("pick_number, team_id, players(name, division)")
    .eq("draft_id", draft?.id ?? 0)
    .order("pick_number");

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const draftedIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank");

  const members = (memberRows ?? []).map((m) => ({
    id: m.id,
    teamName: m.team_name,
    draftPosition: m.draft_position as number,
  }));

  const picks = (pickRows ?? []).map((p: any) => ({
    pickNumber: p.pick_number,
    teamId: p.team_id,
    playerName: p.players?.name ?? "",
    playerDivision: p.players?.division ?? "MPO",
  }));

  const availablePlayers = (allPlayers ?? [])
    .filter((p) => !draftedIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      division: p.division,
      worldRanking: p.world_ranking,
      overallRank: p.overall_rank,
    }));

  const draftPending = draft?.status === "pending";
  const scheduledAt = (draft as any)?.scheduled_at as string | null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Link
          href={`/league/${id}/mock-draft`}
          className="flex items-center gap-2 text-sm bg-[#4B3DFF]/15 hover:bg-[#4B3DFF]/25 border border-[#4B3DFF]/30 text-[#4B3DFF] hover:text-white font-semibold px-3 py-1.5 rounded-lg transition"
        >
          <span>🎯</span>
          <span>Mock Draft</span>
        </Link>
      </div>

      {draftPending && scheduledAt && (
        <div className="bg-[#4B3DFF]/10 border border-[#4B3DFF]/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-lg">📅</span>
          <div>
            <p className="text-white font-semibold text-sm">Draft scheduled</p>
            <p className="text-gray-400 text-xs mt-0.5">
              {new Date(scheduledAt).toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      )}

      {draftPending && isCommissioner && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-5">
          <div>
            <h3 className="text-white font-bold">Pre-draft setup</h3>
            <p className="text-gray-500 text-xs mt-0.5">Commissioner only · only available before the draft begins</p>
          </div>

          <DraftScheduleForm leagueId={Number(id)} scheduledAt={scheduledAt} />

          {/* Order */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs text-gray-400 mb-2">Draft order</p>
              {(allMemberRows ?? []).every((m: any) => m.draft_position == null) ? (
                <p className="text-gray-600 text-sm italic">Not set yet — click Randomize to assign positions.</p>
              ) : (
                <ol className="space-y-1">
                  {(allMemberRows ?? []).map((m: any) => (
                    <li key={m.id} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500 text-xs font-mono w-6 text-right">
                        {m.draft_position ? `#${m.draft_position}` : "—"}
                      </span>
                      <span className="text-white">{m.team_name}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <form action={randomizeDraftOrder.bind(null, Number(id))}>
              <button
                type="submit"
                className="border border-[#36D7B7]/40 hover:bg-[#36D7B7]/10 text-[#36D7B7] hover:text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
              >
                Randomize Order
              </button>
            </form>
          </div>
        </div>
      )}

      <DraftBoard
        leagueId={Number(id)}
        draft={draft ? { id: draft.id, status: draft.status, currentPick: draft.current_pick, totalRounds: draft.total_rounds } : null}
        members={members}
        picks={picks}
        availablePlayers={availablePlayers}
        myMemberId={myMemberRow?.id ?? null}
        isCommissioner={isCommissioner}
        mpoSlots={mpoSlots}
        fpoSlots={fpoSlots}
        rosterSize={rosterSize}
      />
    </div>
  );
}
