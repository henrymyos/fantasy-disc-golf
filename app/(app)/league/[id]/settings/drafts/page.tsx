import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function DraftResultsPage({
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
    .select("id")
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

  const { data: completedDrafts } = await supabase
    .from("drafts")
    .select("id, total_rounds, started_at")
    .eq("league_id", id)
    .eq("status", "complete")
    .order("started_at", { ascending: false });

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">Draft Results</h2>
      </div>

      {completedDrafts && completedDrafts.length > 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
          {completedDrafts.map((d, i) => {
            const date = d.started_at
              ? new Date(d.started_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "Draft";
            return (
              <Link
                key={d.id}
                href={`/league/${id}/draft/${d.id}`}
                className={`flex items-center justify-between px-5 py-4 hover:bg-white/5 transition ${i !== 0 ? "border-t border-white/5" : ""}`}
              >
                <div>
                  <p className="text-white font-medium text-sm">{date}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{d.total_rounds} rounds</p>
                </div>
                <span className="text-gray-400 text-sm">→</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#1a1d23] rounded-2xl p-8 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">No completed drafts yet.</p>
        </div>
      )}
    </div>
  );
}
