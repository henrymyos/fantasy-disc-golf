import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { League } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, team_name, is_commissioner, leagues(id, name, current_week, draft_status, invite_code, max_teams)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  const leagues = (memberships ?? []).map((m) => ({
    ...m.leagues as unknown as League,
    myTeamName: m.team_name,
    isCommissioner: m.is_commissioner,
    membershipId: m.league_id,
  }));

  const activeLeagueIds = leagues
    .filter((l) => l.draft_status === "in_progress" || l.draft_status === "paused")
    .map((l) => l.id);

  type ActiveDraft = {
    leagueId: number;
    leagueName: string;
    status: string;
    currentPick: number;
    totalPicks: number;
    currentRound: number;
    onTheClock: string | null;
    isMyPick: boolean;
  };

  let activeDrafts: ActiveDraft[] = [];

  if (activeLeagueIds.length > 0) {
    const [{ data: draftRows }, { data: memberRows }] = await Promise.all([
      supabase
        .from("drafts")
        .select("id, league_id, status, current_pick, total_rounds")
        .in("status", ["in_progress", "paused"])
        .in("league_id", activeLeagueIds),
      supabase
        .from("league_members")
        .select("id, team_name, draft_position, user_id, league_id")
        .in("league_id", activeLeagueIds)
        .not("draft_position", "is", null),
    ]);

    activeDrafts = (draftRows ?? []).map((draft) => {
      const members = (memberRows ?? []).filter((m) => m.league_id === draft.league_id);
      const numTeams = members.length;
      const league = leagues.find((l) => l.id === draft.league_id);
      const myMember = members.find((m) => m.user_id === user.id);

      const pick = draft.current_pick;
      const round = Math.ceil(pick / numTeams);
      const posInRound = pick - (round - 1) * numTeams;
      const isReversed = round % 2 === 0;
      const draftSlot = isReversed ? numTeams - posInRound + 1 : posInRound;
      const onClockMember = members.find((m) => m.draft_position === draftSlot);

      return {
        leagueId: draft.league_id,
        leagueName: league?.name ?? "",
        status: draft.status,
        currentPick: pick,
        totalPicks: numTeams * draft.total_rounds,
        currentRound: round,
        onTheClock: onClockMember?.team_name ?? null,
        isMyPick: draft.status === "in_progress" && !!myMember && onClockMember?.id === myMember.id,
      };
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">My Leagues</h1>
        <div className="flex gap-3">
          <Link
            href="/league/join"
            className="px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:border-[#36D7B7] hover:text-[#36D7B7] text-sm font-medium transition"
          >
            Join League
          </Link>
          <Link
            href="/league/new"
            className="px-4 py-2 rounded-lg bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold transition"
          >
            Create League
          </Link>
        </div>
      </div>

      {activeDrafts.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <h2 className="text-white font-semibold text-sm uppercase tracking-wider">Live Draft</h2>
          </div>
          {activeDrafts.map((d) => (
            <Link
              key={d.leagueId}
              href={`/league/${d.leagueId}/draft`}
              className={`block rounded-2xl p-5 border transition group ${
                d.isMyPick
                  ? "bg-[#36D7B7]/10 border-[#36D7B7]/40 hover:border-[#36D7B7]/70"
                  : "bg-[#1a1d23] border-white/5 hover:border-[#4B3DFF]/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-semibold">{d.leagueName}</h3>
                    {d.status === "paused" ? (
                      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-medium">Paused</span>
                    ) : (
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-medium">Live</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm">
                    Round {d.currentRound} · Pick {d.currentPick} of {d.totalPicks}
                    {d.status !== "paused" && (
                      <>
                        {" · "}
                        {d.isMyPick ? (
                          <span className="text-[#36D7B7] font-semibold">YOUR PICK!</span>
                        ) : (
                          <span>On the clock: <span className="text-gray-300">{d.onTheClock}</span></span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <span className={`text-sm font-semibold transition ${
                  d.isMyPick ? "text-[#36D7B7] group-hover:text-white" : "text-[#4B3DFF] group-hover:text-white"
                }`}>
                  {d.isMyPick ? "Pick Now →" : "View Draft →"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {leagues.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-4xl mb-3">🥏</p>
          <h2 className="text-white font-semibold text-lg mb-1">No leagues yet</h2>
          <p className="text-gray-500 text-sm mb-6">Create a new league or join one with an invite code</p>
          <Link
            href="/league/new"
            className="inline-block px-6 py-2.5 bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold rounded-lg transition"
          >
            Create Your First League
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/league/${league.id}`}
              className="block bg-[#1a1d23] hover:bg-[#1e2028] border border-white/5 hover:border-[#4B3DFF]/40 rounded-2xl p-5 transition group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-white font-semibold text-lg group-hover:text-[#4B3DFF] transition">
                      {league.name}
                    </h2>
                    {league.isCommissioner && (
                      <span className="text-xs bg-[#36D7B7]/20 text-[#36D7B7] px-2 py-0.5 rounded-full font-medium">
                        Commissioner
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm">
                    Your team: <span className="text-gray-300">{league.myTeamName}</span>
                    {" · "}
                    Week {league.current_week}
                  </p>
                </div>
                <div className="text-right">
                  <DraftBadge status={league.draft_status} />
                  <p className="text-gray-600 text-xs mt-1">Code: {league.invite_code}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "Draft Pending", className: "bg-yellow-500/20 text-yellow-400" },
    in_progress: { label: "Draft Live", className: "bg-green-500/20 text-green-400" },
    complete: { label: "Season Active", className: "bg-[#4B3DFF]/20 text-[#4B3DFF]" },
  };
  const badge = map[status] ?? map.pending;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
      {badge.label}
    </span>
  );
}
