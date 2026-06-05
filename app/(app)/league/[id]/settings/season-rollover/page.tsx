import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonRollover } from "@/components/season-rollover";
import { DEFAULT_SEASON_YEAR } from "@/lib/schedule";

export default async function SeasonRolloverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, commissioner_id, season_year, keepers_per_team")
    .eq("id", id)
    .single();
  if (!league) notFound();
  if ((league as any).commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const currentYear = (league as any).season_year ?? DEFAULT_SEASON_YEAR;
  const nextYear = currentYear + 1;
  const keepersPerTeam = (league as any).keepers_per_team ?? 0;

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
