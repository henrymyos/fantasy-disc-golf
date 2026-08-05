import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
