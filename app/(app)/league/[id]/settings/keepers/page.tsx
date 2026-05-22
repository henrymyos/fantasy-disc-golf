import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KeepersPicker } from "@/components/keepers-picker";

export default async function KeepersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, keepers_per_team, season_year")
    .eq("id", id)
    .single();
  if (!league) notFound();
  const limit = (league as any).keepers_per_team ?? 0;
  const seasonYear = (league as any).season_year ?? new Date().getFullYear();

  const { data: member } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const { data: roster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", member.id);

  const { data: existing } = await supabase
    .from("keeper_picks")
    .select("player_id")
    .eq("league_id", id)
    .eq("season_year", seasonYear)
    .eq("team_id", member.id);
  const initialIds = (existing ?? []).map((k: any) => k.player_id);

  const myRoster = (roster ?? []).map((r: any) => ({
    id: r.players?.id ?? r.player_id,
    name: r.players?.name ?? "Unknown",
    division: r.players?.division ?? "MPO",
  }));

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Keepers</h2>
        <p className="text-gray-500 text-sm mt-1">
          {limit > 0
            ? `Pick up to ${limit} player${limit !== 1 ? "s" : ""} to keep into next season's draft.`
            : "Keepers are disabled for this league. Set keepers per team in settings."}
        </p>
      </div>

      {limit > 0 && (
        <KeepersPicker
          leagueId={Number(id)}
          seasonYear={seasonYear}
          limit={limit}
          roster={myRoster}
          initialIds={initialIds}
        />
      )}
    </div>
  );
}
