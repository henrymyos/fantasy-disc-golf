import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DGPT_2026_SCHEDULE, effectiveSelection } from "@/lib/dgpt-2026-schedule";
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
    .select("id, name, commissioner_id, selected_event_slugs")
    .eq("id", id)
    .single();
  if (!league) notFound();

  if (league.commissioner_id !== user.id) {
    redirect(`/league/${id}/settings`);
  }

  // Drop any stale slugs that aren't on the current schedule (e.g., removed
  // events) so the displayed count doesn't exceed the schedule total.
  const scheduleSlugs = new Set(DGPT_2026_SCHEDULE.map((e) => e.slug));
  const selected = effectiveSelection((league as any).selected_event_slugs)
    .filter((s) => scheduleSlugs.has(s));

  return (
    <EditSeasonForm
      leagueId={id}
      events={DGPT_2026_SCHEDULE}
      initialSelected={selected}
    />
  );
}
