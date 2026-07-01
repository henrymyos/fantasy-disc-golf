import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    .select("league_id, team_name, is_commissioner, leagues(id, name, logo_url, current_week, draft_status, invite_code, max_teams)")
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

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
              {(league as any).logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(league as any).logo_url}
                  alt=""
                  className="w-11 h-11 rounded-xl object-cover shrink-0 bg-white/10"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-[#4B3DFF] font-black text-lg shrink-0">
                  {league.name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
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
