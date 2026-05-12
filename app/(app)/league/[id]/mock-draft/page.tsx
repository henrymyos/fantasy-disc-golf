import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SavedPick = { pickNumber: number; teamIndex: number; playerId: number | null };

export default async function MockDraftHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  // List this user's saved mock drafts for this league (admin client since RLS is off)
  const admin = createAdminClient();
  const { data: drafts } = await admin
    .from("mock_drafts")
    .select("id, my_draft_position, num_teams, roster_size, picks, created_at")
    .eq("user_id", user.id)
    .eq("league_id", id)
    .order("created_at", { ascending: false });

  // Resolve player names for the user's own picks so we can preview their top pick
  const allPlayerIds = new Set<number>();
  for (const d of drafts ?? []) {
    const myTeamIndex = d.my_draft_position - 1;
    const myPicks = ((d.picks ?? []) as SavedPick[]).filter((p) => p.teamIndex === myTeamIndex && p.playerId != null);
    for (const p of myPicks) if (p.playerId) allPlayerIds.add(p.playerId);
  }

  let playersById: Record<number, { name: string; division: string }> = {};
  if (allPlayerIds.size > 0) {
    const { data: players } = await supabase
      .from("players")
      .select("id, name, division")
      .in("id", Array.from(allPlayerIds));
    playersById = Object.fromEntries((players ?? []).map((p) => [p.id, { name: p.name, division: p.division }]));
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/league/${id}`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
        >
          ← {league.name}
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-white font-bold text-xl">Mock Drafts</h2>
          <Link
            href={`/league/${id}/mock-draft/new`}
            className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold text-sm px-4 py-2 rounded-lg transition flex items-center gap-2"
          >
            <span>🎯</span> Start New Mock Draft
          </Link>
        </div>
        <p className="text-gray-500 text-sm mt-2">
          Practice against bots and review your past mock drafts here.
        </p>
      </div>

      <div>
        <h3 className="text-white font-semibold mb-3">History</h3>
        {(drafts ?? []).length === 0 ? (
          <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
            <p className="text-gray-600 text-sm">No mock drafts yet — start one above.</p>
          </div>
        ) : (
          <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
            {(drafts ?? []).map((d, i) => {
              const myTeamIndex = d.my_draft_position - 1;
              const myPicks = ((d.picks ?? []) as SavedPick[])
                .filter((p) => p.teamIndex === myTeamIndex && p.playerId != null)
                .sort((a, b) => a.pickNumber - b.pickNumber);
              const topPick = myPicks[0]?.playerId ? playersById[myPicks[0].playerId] : null;
              const date = new Date(d.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              const time = new Date(d.created_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              });
              return (
                <Link
                  key={d.id}
                  href={`/league/${id}/mock-draft/${d.id}`}
                  className={`flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/5 transition ${i !== 0 ? "border-t border-white/5" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-white font-medium text-sm">
                      {date} <span className="text-gray-600">· {time}</span>
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      Pick #{d.my_draft_position} of {d.num_teams} · {myPicks.length} players drafted
                    </p>
                  </div>
                  {topPick && (
                    <div className="text-right shrink-0 min-w-0 hidden sm:block">
                      <p className="text-gray-600 text-[10px] uppercase tracking-wider font-semibold">Top pick</p>
                      <p className="text-white text-sm font-medium truncate">{topPick.name}</p>
                    </div>
                  )}
                  <span className="text-gray-600 text-lg shrink-0">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
