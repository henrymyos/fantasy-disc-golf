import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DraftBoard } from "@/components/draft-board";
import { DraftScheduleForm } from "@/components/draft-schedule-form";
import { LocalTime } from "@/components/local-time";
import { randomizeDraftOrder } from "@/actions/drafts";
import { setSecondsPerPick } from "@/actions/draft-config";
import { DraftTypeForm } from "@/components/draft-type-form";
import { DurationPicker } from "@/components/duration-picker";
import { AuctionPanel } from "@/components/auction-panel";

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
    .select("id, status, current_pick, total_rounds, scheduled_at, type, auction_budget, seconds_per_pick, current_pick_started_at, third_round_reversal")
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
    .select("pick_number, team_id, players(id, name, division)")
    .eq("draft_id", draft?.id ?? 0)
    .order("pick_number");

  // Traded pick-slot ownership for the current draft (empty in untraded
  // drafts). Lets the board show the right team on the clock for traded slots.
  const { data: pickOwnerRows } = await supabase
    .from("current_draft_pick_owners")
    .select("overall_pick, owner_team_id")
    .eq("draft_id", draft?.id ?? 0);
  const pickOwnerOverrides = (pickOwnerRows ?? []).map((r: any) => ({
    overallPick: r.overall_pick as number,
    ownerTeamId: r.owner_team_id as number,
  }));

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const draftedIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking, overall_rank, pdga_rating");

  // This user's personal player rankings for this league (set on the
  // rankings page). When present, the available-players panel can sort by
  // them instead of the default points/overall ordering.
  const { data: myRankingRows } = await supabase
    .from("user_player_rankings")
    .select("player_id, rank")
    .eq("user_id", user.id)
    .eq("league_id", id)
    .order("rank", { ascending: true });
  const myRankings = (myRankingRows ?? []).map((r: any) => ({
    playerId: r.player_id as number,
    rank: r.rank as number,
  }));

  // Sum each player's fantasy points this season so the available list can
  // be ordered like the points leaders view (highest first).
  const { data: resultRows } = await supabase
    .from("tournament_results")
    .select("player_id, fantasy_points");
  const pointsByPlayer = new Map<number, number>();
  (resultRows ?? []).forEach((r: any) => {
    pointsByPlayer.set(
      r.player_id,
      (pointsByPlayer.get(r.player_id) ?? 0) + Number(r.fantasy_points ?? 0),
    );
  });

  const members = (memberRows ?? []).map((m) => ({
    id: m.id,
    teamName: m.team_name,
    draftPosition: m.draft_position as number,
  }));

  const picks = (pickRows ?? []).map((p: any) => ({
    pickNumber: p.pick_number,
    teamId: p.team_id,
    playerId: p.players?.id ?? null,
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
      pdgaRating: (p as any).pdga_rating ?? null,
      totalPoints: Math.round((pointsByPlayer.get(p.id) ?? 0) * 10) / 10,
    }));

  const draftPending = draft?.status === "pending";
  const scheduledAt = (draft as any)?.scheduled_at as string | null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/league/${id}/rankings`}
          className="flex items-center gap-2 text-sm bg-[#36D7B7]/15 hover:bg-[#36D7B7]/25 border border-[#36D7B7]/30 text-[#36D7B7] hover:text-white font-semibold px-3 py-1.5 rounded-lg transition"
        >
          <span>⭐</span>
          <span>My Rankings</span>
        </Link>
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
              <LocalTime
                iso={scheduledAt}
                options={{
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                }}
              />
              {" · "}
              <span className="text-gray-400">commissioner starts manually</span>
            </p>
          </div>
        </div>
      )}

      {draftPending && isCommissioner && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-5">
          <div>
            <h3 className="text-white font-bold">Pre-draft setup</h3>
            <p className="text-gray-400 text-xs mt-0.5">Commissioner only · only available before the draft begins</p>
          </div>

          <DraftScheduleForm leagueId={Number(id)} scheduledAt={scheduledAt} />

          {/* Per-pick timer */}
          <form
            action={async (formData: FormData) => {
              "use server";
              const seconds = Number(formData.get("secondsPerPick") ?? 60);
              await setSecondsPerPick(Number(id), seconds);
            }}
            className="flex flex-wrap items-end gap-3 pt-3 border-t border-white/5"
          >
            <div>
              <label className="block text-xs text-gray-400 mb-1">Time per pick</label>
              <DurationPicker
                name="secondsPerPick"
                defaultSeconds={(draft as any)?.seconds_per_pick ?? 60}
              />
            </div>
            <button
              type="submit"
              className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Save timer
            </button>
            <p className="w-full text-gray-400 text-xs">
              If a pick isn't made within this window, the highest-ranked available player is auto-picked.
            </p>
          </form>

          <DraftTypeForm
            leagueId={Number(id)}
            initialType={((draft as any)?.type ?? "snake") as "snake" | "auction"}
            initialBudget={(draft as any)?.auction_budget ?? 200}
            initialThirdRoundReversal={!!(draft as any)?.third_round_reversal}
          />

          {/* Order */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs text-gray-400 mb-2">Draft order</p>
              {(allMemberRows ?? []).every((m: any) => m.draft_position == null) ? (
                <p className="text-gray-400 text-sm italic">Not set yet — click Randomize to assign positions.</p>
              ) : (
                <ol className="space-y-1">
                  {(allMemberRows ?? []).map((m: any) => (
                    <li key={m.id} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-400 text-xs font-mono w-6 text-right">
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

      {(draft as any)?.type === "auction" && draft?.status === "in_progress" && (
        <AuctionPanel leagueId={Number(id)} myUserId={user.id} />
      )}

      <DraftBoard
        leagueId={Number(id)}
        draft={draft ? {
          id: draft.id,
          status: draft.status,
          currentPick: draft.current_pick,
          totalRounds: draft.total_rounds,
          secondsPerPick: (draft as any).seconds_per_pick ?? 60,
          currentPickStartedAt: (draft as any).current_pick_started_at ?? null,
          thirdRoundReversal: !!(draft as any).third_round_reversal,
        } : null}
        members={members}
        pickOwnerOverrides={pickOwnerOverrides}
        picks={picks}
        availablePlayers={availablePlayers}
        myRankings={myRankings}
        myMemberId={myMemberRow?.id ?? null}
        isCommissioner={isCommissioner}
        mpoSlots={mpoSlots}
        fpoSlots={fpoSlots}
        rosterSize={rosterSize}
      />
    </div>
  );
}
