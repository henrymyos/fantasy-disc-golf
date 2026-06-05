import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getScheduleEvents, getScheduleSeasons, DEFAULT_SEASON_YEAR } from "@/lib/schedule";
import { ScheduleAdmin } from "@/components/schedule-admin";

export default async function ScheduleAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  const seasons = await getScheduleSeasons(supabase);
  const requested = Number((await searchParams).year);
  const year = Number.isFinite(requested) && requested > 0 ? requested : (seasons[0] ?? DEFAULT_SEASON_YEAR);
  const events = await getScheduleEvents(supabase, year);

  return <ScheduleAdmin seasons={seasons} year={year} events={events} />;
}
