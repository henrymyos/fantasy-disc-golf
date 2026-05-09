import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteLeague } from "@/actions/leagues";

export default async function LeagueSettingsPage({
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
    .select("id, name, commissioner_id")
    .eq("id", id)
    .single();

  if (!league) notFound();
  if (league.commissioner_id !== user.id) redirect(`/league/${id}`);

  return (
    <div className="max-w-xl">
      <h2 className="text-white font-bold text-lg mb-6">League Settings</h2>

      <div className="border border-red-500/30 rounded-xl p-5 bg-red-500/5">
        <h3 className="text-red-400 font-semibold mb-1">Danger Zone</h3>
        <p className="text-gray-400 text-sm mb-4">
          Permanently delete <span className="text-white font-medium">{league.name}</span> and all
          of its data. This cannot be undone.
        </p>
        <form
          action={async () => {
            "use server";
            await deleteLeague(id);
          }}
        >
          <button
            type="submit"
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            Delete League
          </button>
        </form>
      </div>
    </div>
  );
}
