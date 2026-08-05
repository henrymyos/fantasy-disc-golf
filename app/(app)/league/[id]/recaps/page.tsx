import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeagueSchedule } from "@/lib/league-schedule";
import { generateWeeklyRecap } from "@/lib/weekly-recap";
import { WeeklyRecapCard } from "@/components/weekly-recap-card";

export default async function RecapsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: recaps } = await supabase
    .from("weekly_recaps")
    .select("week, body, created_at")
    .eq("league_id", id)
    .order("week", { ascending: false });

  // Regenerate stale recap formats in place — generateWeeklyRecap upserts the
  // fresh body, so each one self-heals. Stale means: written before the awards
  // format (a single paragraph, no newlines), or with a points-based Blowout
  // line from before the percent-margin ranking (no % in the award).
  const legacy = (recaps ?? []).filter((r: any) => {
    const body = String(r.body ?? "");
    if (!body.includes("\n")) return true;
    return body.includes("**Biggest Blowout:**") && !/\*\*Biggest Blowout:\*\*[^\n]*%/.test(body);
  });
  if (legacy.length > 0) {
    const admin = createAdminClient();
    const schedule = await getLeagueSchedule(admin, Number(id)).catch(() => null);
    for (const r of legacy) {
      const tournamentIds = schedule?.weekToTournamentIds.get((r as any).week) ?? [];
      const fresh = await generateWeeklyRecap(admin, Number(id), (r as any).week, tournamentIds).catch(() => null);
      if (fresh) (r as any).body = fresh;
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/league/${id}`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← {(league as any).name}
        </Link>
        <h2 className="text-white font-bold text-xl">Weekly Recaps</h2>
        <p className="text-gray-400 text-sm mt-1">
          Results and awards from every finalized week.
        </p>
      </div>

      {(recaps ?? []).length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-8 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">
            No recaps yet — the first one lands after a week is finalized.
          </p>
        </div>
      ) : (
        (recaps ?? []).map((r: any) => (
          <WeeklyRecapCard
            key={r.week}
            week={r.week}
            body={r.body}
            createdAt={r.created_at ?? null}
          />
        ))
      )}
    </div>
  );
}
