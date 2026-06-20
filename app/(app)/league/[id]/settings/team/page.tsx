import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { EditTeamForm } from "@/components/edit-team-form";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("league_members")
    .select("id, team_name")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) notFound();

  const { data: roster } = await supabase
    .from("rosters")
    .select("player_id, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", member.id);

  const { data: nicknameRows } = await supabase
    .from("player_nicknames")
    .select("player_id, nickname")
    .eq("team_id", member.id);
  const nicknameByPlayer = new Map<number, string>(
    (nicknameRows ?? []).map((r: any) => [r.player_id as number, r.nickname as string]),
  );

  const players = (roster ?? [])
    .map((r: any) => ({
      id: r.player_id as number,
      name: (r.players?.name as string) ?? "Unknown",
      division: (r.players?.division as string) ?? "MPO",
      nickname: nicknameByPlayer.get(r.player_id) ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <BackLink
          fallbackHref={`/league/${id}/settings`}
          label="Settings"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white bg-[#1a1d23] border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg transition mb-3"
        />
        <h2 className="text-white font-bold text-xl">Team</h2>
        <p className="text-gray-400 text-sm mt-1">
          Rename your team and give your players nicknames — they show in
          parentheses under each player on your team and in matchups.
        </p>
      </div>

      <EditTeamForm leagueId={Number(id)} initialName={member.team_name} players={players} />
    </div>
  );
}
