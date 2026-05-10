import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteLeague } from "@/actions/leagues";
import { LeagueSettingsForm } from "@/components/league-settings-form";
import { ScoringRules } from "@/components/scoring-rules";

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
    .select("id, name, commissioner_id, max_teams, roster_size, starters_count")
    .eq("id", id)
    .single();

  if (!league) notFound();

  // Must be a league member to view this page
  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();

  if (!member) redirect(`/league/${id}`);

  const isCommissioner = league.commissioner_id === user.id;

  const { data: divData } = await supabase
    .from("leagues")
    .select("mpo_starters, fpo_starters")
    .eq("id", id)
    .single();

  const mpoStarters: number = (divData as any)?.mpo_starters ?? 4;
  const fpoStarters: number = (divData as any)?.fpo_starters ?? 2;

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h2 className="text-white font-bold text-lg mb-5">League Settings</h2>
        <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
          {isCommissioner ? (
            <LeagueSettingsForm
              leagueId={id}
              initial={{
                name: league.name,
                maxTeams: league.max_teams,
                rosterSize: league.roster_size,
                mpoStarters,
                fpoStarters,
              }}
            />
          ) : (
            <ReadOnlySettings
              name={league.name}
              maxTeams={league.max_teams}
              rosterSize={league.roster_size}
              mpoStarters={mpoStarters}
              fpoStarters={fpoStarters}
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="text-white font-bold text-lg mb-5">Scoring</h2>
        <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
          <ScoringRules mpoStarters={mpoStarters} fpoStarters={fpoStarters} />
        </div>
      </div>

      {isCommissioner && (
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
      )}
    </div>
  );
}

function ReadOnlySettings({
  name,
  maxTeams,
  rosterSize,
  mpoStarters,
  fpoStarters,
}: {
  name: string;
  maxTeams: number;
  rosterSize: number;
  mpoStarters: number;
  fpoStarters: number;
}) {
  const rows = [
    { label: "League Name", value: name },
    { label: "Max Teams", value: maxTeams },
    { label: "Roster Size", value: rosterSize },
    { label: "MPO Starters", value: mpoStarters },
    { label: "FPO Starters", value: fpoStarters },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600 mb-4">Only the commissioner can edit league settings.</p>
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
          <span className="text-gray-400 text-sm">{label}</span>
          <span className="text-white text-sm font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}
