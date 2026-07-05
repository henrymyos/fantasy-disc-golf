import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { effectiveSelection, playoffCountForTeams } from "@/lib/dgpt-2026-schedule";
import { getScheduleEvents, resolveScheduleYear, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { EditSeasonForm } from "@/components/edit-season-form";

export default async function EditSeasonPage({
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
    .select("id, name, commissioner_id, selected_event_slugs, season_year, max_teams")
    .eq("id", id)
    .single();
  if (!league) notFound();

  if (league.commissioner_id !== user.id) {
    redirect(`/league/${id}/settings`);
  }

  // The league's stored season_year may not have a loaded schedule (e.g. an
  // older 2025-labelled league that plays the 2026 slate). Resolve to the year
  // that actually has events so the editor never renders empty.
  const requestedYear = (league as any).season_year ?? DEFAULT_SEASON_YEAR;
  const seasonYear = await resolveScheduleYear(supabase, requestedYear);
  const events = await getScheduleEvents(supabase, seasonYear);

  // Drop any stale slugs that aren't on the current schedule (e.g., removed
  // events) so the displayed count doesn't exceed the schedule total.
  const scheduleSlugs = new Set(events.map((e) => e.slug));
  const selected = effectiveSelection((league as any).selected_event_slugs, events)
    .filter((s) => scheduleSlugs.has(s));

  return (
    <EditSeasonForm
      leagueId={id}
      seasonYear={seasonYear}
      events={events}
      initialSelected={selected}
      hasExplicitSelection={(league as any).selected_event_slugs != null}
      playoffCount={playoffCountForTeams((league as any).max_teams)}
    />
  );
}
