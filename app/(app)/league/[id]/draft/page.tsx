import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startDraft, pauseDraft, resumeDraft, makeDraftPick } from "@/actions/drafts";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, draft_status, roster_size")
    .eq("id", id)
    .single();

  if (!league) notFound();

  const isCommissioner = league.commissioner_id === user.id;

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick, total_rounds")
    .eq("league_id", id)
    .single();

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, user_id, draft_position, profiles(username)")
    .eq("league_id", id)
    .not("draft_position", "is", null)
    .order("draft_position");

  const { data: myMember } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("pick_number, round, team_id, player_id, players(name, division)")
    .eq("draft_id", draft?.id ?? 0)
    .order("pick_number");

  const { data: rosteredSpots } = await supabase
    .from("rosters")
    .select("player_id")
    .eq("league_id", id);

  const draftedIds = new Set((rosteredSpots ?? []).map((r) => r.player_id));

  const { data: availablePlayers } = await supabase
    .from("players")
    .select("id, name, division, world_ranking");

  const available = (availablePlayers ?? [])
    .filter((p) => !draftedIds.has(p.id))
    .sort((a, b) => {
      if (a.division !== b.division) return a.division === "MPO" ? -1 : 1;
      if (a.world_ranking !== b.world_ranking) {
        if (a.world_ranking == null) return 1;
        if (b.world_ranking == null) return -1;
        return a.world_ranking - b.world_ranking;
      }
      return a.name.localeCompare(b.name);
    });

  const numTeams = members?.length ?? 0;
  let currentPickTeamId: number | null = null;
  let currentRound = 1;

  if (draft?.status === "in_progress" && numTeams > 0) {
    const pick = draft.current_pick;
    currentRound = Math.ceil(pick / numTeams);
    const posInRound = pick - (currentRound - 1) * numTeams;
    const isReversed = currentRound % 2 === 0;
    const draftSlot = isReversed ? numTeams - posInRound + 1 : posInRound;
    const current = members?.find((m) => m.draft_position === draftSlot);
    currentPickTeamId = current?.id ?? null;
  }

  const isMyPick = currentPickTeamId !== null && currentPickTeamId === myMember?.id && draft?.status === "in_progress";

  return (
    <div className="space-y-6">
      {/* Draft status header */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white text-lg">
              {draft?.status === "pending" && "Draft Not Started"}
              {draft?.status === "in_progress" && `Round ${currentRound} — Pick ${draft.current_pick}`}
              {draft?.status === "paused" && `Paused — Round ${currentRound}, Pick ${draft?.current_pick}`}
              {draft?.status === "complete" && "Draft Complete"}
            </h2>
            {draft?.status === "in_progress" && (
              <p className={`text-sm mt-0.5 ${isMyPick ? "text-[#36D7B7] font-semibold" : "text-gray-400"}`}>
                {isMyPick
                  ? "It's YOUR pick!"
                  : `On the clock: ${members?.find((m) => m.id === currentPickTeamId)?.team_name}`}
              </p>
            )}
            {draft?.status === "paused" && (
              <p className="text-yellow-400 text-sm mt-0.5">Draft is paused by the commissioner</p>
            )}
          </div>
          <div className="flex gap-2">
            {isCommissioner && draft?.status === "pending" && (
              <form action={startDraft.bind(null, Number(id))}>
                <button type="submit" className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-6 py-2 rounded-lg transition">
                  Start Draft
                </button>
              </form>
            )}
            {isCommissioner && draft?.status === "in_progress" && (
              <form action={pauseDraft.bind(null, Number(id))}>
                <button type="submit" className="border border-yellow-500/40 text-yellow-400 hover:bg-yellow-400/10 font-semibold px-4 py-2 rounded-lg transition text-sm">
                  Pause Draft
                </button>
              </form>
            )}
            {isCommissioner && draft?.status === "paused" && (
              <form action={resumeDraft.bind(null, Number(id))}>
                <button type="submit" className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-6 py-2 rounded-lg transition">
                  Resume Draft
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Draft order */}
        {(members ?? []).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(members ?? []).map((m) => (
              <div
                key={m.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  m.id === currentPickTeamId
                    ? "bg-[#36D7B7] text-black border-[#36D7B7]"
                    : "bg-white/5 text-gray-400 border-white/10"
                }`}
              >
                {m.draft_position}. {m.team_name}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Available players */}
        {(draft?.status === "in_progress" || draft?.status === "paused") && (
          <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
            <h3 className="font-semibold text-white mb-4">Available Players ({available.length})</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {available.map((player) => (
                <div key={player.id} className="flex items-center justify-between p-3 rounded-xl bg-[#0f1117] border border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600 text-xs font-mono w-6 text-right shrink-0">
                      {player.world_ranking != null ? `#${player.world_ranking}` : ""}
                    </span>
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {player.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{player.name}</p>
                      <p className="text-gray-600 text-xs">{player.division ?? "MPO"}</p>
                    </div>
                  </div>
                  {isMyPick && (
                    <form action={makeDraftPick.bind(null, Number(id), player.id)}>
                      <button
                        type="submit"
                        className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-full transition"
                      >
                        Draft
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Draft board / picks */}
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h3 className="font-semibold text-white mb-4">Draft Board</h3>
          {(picks ?? []).length === 0 ? (
            <p className="text-gray-600 text-sm">No picks yet</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {[...(picks ?? [])].reverse().map((pick: any) => {
                const team = members?.find((m) => m.id === pick.team_id);
                return (
                  <div key={pick.pick_number} className="flex items-center gap-3 p-2 rounded-lg bg-[#0f1117]">
                    <span className="text-gray-600 text-xs w-12">
                      R{pick.round}.{pick.pick_number}
                    </span>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{pick.players?.name}</p>
                      <p className="text-gray-500 text-xs">{team?.team_name}</p>
                    </div>
                    <span className="text-gray-600 text-xs">{pick.players?.division}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
