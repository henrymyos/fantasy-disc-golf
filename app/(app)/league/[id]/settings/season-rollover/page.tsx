import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonRollover } from "@/components/season-rollover";
import { getScheduleEvents, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { effectiveSelection } from "@/lib/dgpt-2026-schedule";
import { isSeasonOver } from "@/lib/season-status";

export default async function SeasonRolloverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, season_year, keepers_per_team, selected_event_slugs")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if ((league as any).commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const currentYear = (league as any).season_year ?? DEFAULT_SEASON_YEAR;
  const nextYear = currentYear + 1;
  const keepersPerTeam = (league as any).keepers_per_team ?? 0;

  // Don't allow rolling over until the season is actually finished.
  const scheduleEvents = await getScheduleEvents(supabase, currentYear);
  const seasonOver = isSeasonOver(
    scheduleEvents,
    effectiveSelection((league as any).selected_event_slugs, scheduleEvents),
  );
  if (!seasonOver) {
    return (
      <div className="max-w-2xl">
        <Link href={`/league/${id}/settings`} className="text-gray-400 hover:text-white text-sm transition inline-block mb-4">
          ← Settings
        </Link>
        <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
          <h1 className="text-lg font-bold text-white">The {currentYear} season isn&apos;t over yet</h1>
          <p className="text-gray-400 text-sm mt-2">
            You can start the next season once all of this season&apos;s events have finished. Come back
            after the final week — the option will appear here and on the commissioner dashboard.
          </p>
        </div>
      </div>
    );
  }

  const [{ count: memberCount }, { data: keeperRows }, { count: nextScheduleCount }] = await Promise.all([
    supabase.from("league_members").select("id", { count: "exact", head: true }).eq("league_id", id),
    supabase.from("keeper_picks").select("team_id").eq("league_id", id).eq("season_year", nextYear),
    supabase.from("schedule_events").select("id", { count: "exact", head: true }).eq("season_year", nextYear),
  ]);

  const keeperReadyCount = new Set((keeperRows ?? []).map((r: any) => r.team_id)).size;

  return (
    <SeasonRollover
      leagueId={Number(id)}
      currentYear={currentYear}
      nextYear={nextYear}
      keepersPerTeam={keepersPerTeam}
      keeperReadyCount={keeperReadyCount}
      memberCount={memberCount ?? 0}
      nextScheduleExists={(nextScheduleCount ?? 0) > 0}
    />
  );
}
