import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LeagueSettingsForm } from "@/components/league-settings-form";

export default async function LeagueSettingsSubpage({
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
    .select("id, name, commissioner_id, max_teams, roster_size, mpo_starters, fpo_starters, waiver_order_mode, scoring_mode, keepers_per_team")
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

  const isCommissioner = league.commissioner_id === user.id;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href={`/league/${id}/settings`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Settings
        </Link>
        <h2 className="text-white font-bold text-xl">League Settings</h2>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-6 border border-white/5">
        {isCommissioner ? (
          <LeagueSettingsForm
            leagueId={id}
            initial={{
              name: league.name,
              maxTeams: (league as any).max_teams,
              rosterSize: (league as any).roster_size,
              mpoStarters: (league as any).mpo_starters ?? 4,
              fpoStarters: (league as any).fpo_starters ?? 2,
              waiverOrderMode: ((league as any).waiver_order_mode ?? "reverse_standings") as
                | "reverse_standings"
                | "reverse_last_add",
              scoringMode: ((league as any).scoring_mode ?? "head_to_head") as
                | "head_to_head"
                | "all_play"
                | "median",
              keepersPerTeam: (league as any).keepers_per_team ?? 0,
            }}
          />
        ) : (
          <ReadOnlySettings
            name={league.name}
            maxTeams={(league as any).max_teams}
            rosterSize={(league as any).roster_size}
            mpoStarters={(league as any).mpo_starters ?? 4}
            fpoStarters={(league as any).fpo_starters ?? 2}
          />
        )}
      </div>
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
      <p className="text-xs text-gray-400 mb-4">Only the commissioner can edit league settings.</p>
      {rows.map(({ label, value }) => (
        <div
          key={label}
          className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
        >
          <span className="text-gray-400 text-sm">{label}</span>
          <span className="text-white text-sm font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}
