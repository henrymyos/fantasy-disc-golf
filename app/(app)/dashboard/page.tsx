import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePickOwnerId, buildPickOwnerOverrides } from "@/lib/draft-pick-owners";
import type { League } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const username = profile?.username ?? "there";

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

  // Current team counts per league (one query, counted in memory).
  const leagueIds = leagues.map((l) => l.id);
  const { data: memberCountRows } = leagueIds.length
    ? await supabase.from("league_members").select("league_id").in("league_id", leagueIds)
    : { data: [] as { league_id: number }[] };
  const countByLeague = new Map<number, number>();
  (memberCountRows ?? []).forEach((r: { league_id: number }) => {
    countByLeague.set(r.league_id, (countByLeague.get(r.league_id) ?? 0) + 1);
  });

  const commissionerCount = leagues.filter((l) => l.isCommissioner).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

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
        .select("id, league_id, status, current_pick, total_rounds, third_round_reversal")
        .in("status", ["in_progress", "paused"])
        .in("league_id", activeLeagueIds),
      supabase
        .from("league_members")
        .select("id, team_name, draft_position, user_id, league_id")
        .in("league_id", activeLeagueIds)
        .not("draft_position", "is", null),
    ]);

    // Traded pick-slot ownership for these drafts (honored for the on-clock team).
    const draftIds = (draftRows ?? []).map((d: any) => d.id);
    const { data: ownerRows } = draftIds.length > 0
      ? await supabase
          .from("current_draft_pick_owners")
          .select("draft_id, overall_pick, owner_team_id")
          .in("draft_id", draftIds)
      : { data: [] };
    const ownersByDraft = new Map<number, { overall_pick: number; owner_team_id: number }[]>();
    (ownerRows ?? []).forEach((r: any) => {
      const arr = ownersByDraft.get(r.draft_id) ?? [];
      arr.push({ overall_pick: r.overall_pick, owner_team_id: r.owner_team_id });
      ownersByDraft.set(r.draft_id, arr);
    });

    activeDrafts = (draftRows ?? []).map((draft) => {
      const members = (memberRows ?? []).filter((m) => m.league_id === draft.league_id);
      const numTeams = members.length;
      const league = leagues.find((l) => l.id === draft.league_id);
      const myMember = members.find((m) => m.user_id === user.id);

      const pick = draft.current_pick;
      const round = Math.ceil(pick / numTeams);
      const onClockId = resolvePickOwnerId(
        pick,
        members.map((m) => ({ id: m.id, draftPosition: m.draft_position })),
        !!(draft as any).third_round_reversal,
        buildPickOwnerOverrides(ownersByDraft.get((draft as any).id)),
      );
      const onClockMember = members.find((m) => m.id === onClockId);

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
    <div className="max-w-3xl space-y-6">
      {/* Greeting + actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {greeting}, <span className="text-[#4B3DFF]">{username}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Here&apos;s what&apos;s happening in your leagues.</p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <Link
            href="/league/join"
            className="flex-1 sm:flex-initial text-center px-4 py-2.5 sm:py-2 rounded-lg border border-white/10 text-gray-300 hover:border-[#36D7B7] hover:text-[#36D7B7] text-sm font-medium transition"
          >
            Join League
          </Link>
          <Link
            href="/league/new"
            className="flex-1 sm:flex-initial text-center px-4 py-2.5 sm:py-2 rounded-lg bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold transition"
          >
            Create League
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Leagues" value={leagues.length} />
        <StatTile label="Commissioner" value={commissionerCount} />
        <StatTile label="Live drafts" value={activeDrafts.length} accent={activeDrafts.length > 0} />
      </div>

      {activeDrafts.length > 0 && (
        <div className="space-y-3">
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

      <div className="space-y-3">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wider text-gray-400">My Leagues</h2>
        {leagues.length === 0 ? (
          <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
            <p className="text-4xl mb-3">🥏</p>
            <h3 className="text-white font-semibold text-lg mb-1">No leagues yet</h3>
            <p className="text-gray-400 text-sm mb-6">Create a new league or join one with an invite code</p>
            <Link
              href="/league/new"
              className="inline-block px-6 py-2.5 bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold rounded-lg transition"
            >
              Create Your First League
            </Link>
          </div>
        ) : (
          leagues.map((league) => (
            <Link
              key={league.id}
              href={`/league/${league.id}`}
              className="flex items-center gap-4 bg-[#1a1d23] hover:bg-[#1e2028] border border-white/5 hover:border-[#4B3DFF]/40 rounded-2xl p-4 transition group"
            >
              <div className="w-11 h-11 rounded-xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-[#4B3DFF] font-black text-lg shrink-0">
                {league.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-semibold truncate group-hover:text-[#4B3DFF] transition">
                    {league.name}
                  </h3>
                  {league.isCommissioner && (
                    <span className="shrink-0 text-[10px] bg-[#36D7B7]/20 text-[#36D7B7] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                      Commish
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-xs mt-0.5 truncate">
                  <span className="text-gray-300">{league.myTeamName}</span>
                  {" · "}
                  {(countByLeague.get(league.id) ?? 0)}/{league.max_teams} teams
                  {" · "}Week {league.current_week}
                </p>
              </div>
              <div className="text-right shrink-0">
                <DraftBadge status={league.draft_status} />
                <p className="text-gray-500 text-[10px] mt-1 font-mono">{league.invite_code}</p>
              </div>
            </Link>
          ))
        )}
      </div>

    </div>
  );
}

function StatTile({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "bg-[#36D7B7]/10 border-[#36D7B7]/30" : "bg-[#1a1d23] border-white/5"}`}>
      <p className={`text-2xl font-black ${accent ? "text-[#36D7B7]" : "text-white"}`}>{value}</p>
      <p className="text-gray-400 text-xs mt-0.5">{label}</p>
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
