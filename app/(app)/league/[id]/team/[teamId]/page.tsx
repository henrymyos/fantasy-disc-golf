import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string; teamId: string }>;
}) {
  const { id, teamId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Viewer must be a member of this league.
  const { data: myMember } = await supabase
    .from("league_members")
    .select("id, user_id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!myMember) redirect(`/league/${id}`);

  // If the viewer clicked into their own team, redirect them to the editable view.
  if (myMember.id === Number(teamId)) redirect(`/league/${id}/lineups`);

  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size, mpo_starters, fpo_starters")
    .eq("id", id)
    .single();
  if (!league) notFound();

  const mpoSlots: number = (league as any).mpo_starters ?? 4;
  const fpoSlots: number = (league as any).fpo_starters ?? 2;

  const { data: team } = await supabase
    .from("league_members")
    .select("id, team_name, profiles(username)")
    .eq("league_id", id)
    .eq("id", teamId)
    .single();
  if (!team) notFound();

  const { data: rosterRows } = await supabase
    .from("rosters")
    .select("id, is_starter, player_id, lineup_order, players(id, name, division)")
    .eq("league_id", id)
    .eq("team_id", teamId)
    .order("lineup_order", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const roster = rosterRows ?? [];

  function buildSlotArray(starters: any[], numSlots: number): (any | null)[] {
    const result: (any | null)[] = new Array(numSlots).fill(null);
    const unordered: any[] = [];
    for (const s of starters) {
      const o = (s as any).lineup_order;
      if (o != null && o >= 1 && o <= numSlots && result[o - 1] === null) {
        result[o - 1] = s;
      } else {
        unordered.push(s);
      }
    }
    let ui = 0;
    for (let i = 0; i < numSlots && ui < unordered.length; i++) {
      if (result[i] === null) result[i] = unordered[ui++];
    }
    return result;
  }

  const allMpoStarters = roster.filter(
    (r) => r.is_starter && (r.players as any)?.division === "MPO",
  );
  const allFpoStarters = roster.filter(
    (r) => r.is_starter && (r.players as any)?.division === "FPO",
  );
  const mpoSlotArray = buildSlotArray(allMpoStarters, mpoSlots);
  const fpoSlotArray = buildSlotArray(allFpoStarters, fpoSlots);

  const starterIds = new Set(
    [...mpoSlotArray, ...fpoSlotArray].filter(Boolean).map((r: any) => r.id),
  );
  const bench = roster.filter((r) => !starterIds.has(r.id));

  const totalFilledStarters =
    mpoSlotArray.filter(Boolean).length + fpoSlotArray.filter(Boolean).length;
  const totalSlots = mpoSlots + fpoSlots;

  return (
    <div className="max-w-2xl space-y-4">
      <Link
        href={`/league/${id}`}
        className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
      >
        ← Back
      </Link>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-white text-lg">{team.team_name}</h2>
            {(team as any).profiles?.username && (
              <p className="text-gray-500 text-xs mt-0.5">
                {(team as any).profiles.username}
              </p>
            )}
          </div>
          <span className="text-gray-500 text-sm">
            {totalFilledStarters}/{totalSlots} starters
          </span>
        </div>

        <div className="space-y-2 mb-6">
          {mpoSlotArray.map((occupant: any, i) => (
            <LineupRow
              key={`mpo-${i}`}
              leagueId={Number(id)}
              division="MPO"
              slotIndex={i + 1}
              occupant={occupant}
            />
          ))}
          {fpoSlotArray.map((occupant: any, i) => (
            <LineupRow
              key={`fpo-${i}`}
              leagueId={Number(id)}
              division="FPO"
              slotIndex={i + 1}
              occupant={occupant}
            />
          ))}
        </div>

        {bench.length > 0 && (
          <>
            <h3 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
              Bench
            </h3>
            <div className="space-y-2">
              {bench.map((spot: any) => (
                <BenchRow key={spot.id} leagueId={Number(id)} spot={spot} />
              ))}
            </div>
          </>
        )}

        {roster.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-4">
            No players on this roster.
          </p>
        )}
      </div>
    </div>
  );
}

function LineupRow({
  leagueId,
  division,
  occupant,
}: {
  leagueId: number;
  division: "MPO" | "FPO";
  slotIndex: number;
  occupant: any;
}) {
  const isMpo = division === "MPO";
  const color = isMpo ? "#4B3DFF" : "#36D7B7";
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border"
      style={{
        background: occupant
          ? isMpo
            ? "var(--mpo-fill)"
            : "var(--fpo-fill)"
          : "rgba(255,255,255,0.02)",
        borderColor: occupant
          ? isMpo
            ? "var(--mpo-fill-border)"
            : "var(--fpo-fill-border)"
          : "rgba(255,255,255,0.06)",
      }}
    >
      <span
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {division}
      </span>
      {occupant?.players ? (
        <Link
          href={`/league/${leagueId}/player/${occupant.player_id}`}
          className="flex-1 text-white text-sm font-medium truncate hover:underline"
        >
          {occupant.players.name}
        </Link>
      ) : (
        <p className="flex-1 text-gray-600 text-sm italic">Empty</p>
      )}
    </div>
  );
}

function BenchRow({ leagueId, spot }: { leagueId: number; spot: any }) {
  const player = spot.players;
  const div: "MPO" | "FPO" = (player?.division as any) ?? "MPO";
  const color = div === "MPO" ? "#4B3DFF" : "#36D7B7";
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[#0f1117] border border-white/5">
      <span
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {div}
      </span>
      <Link
        href={`/league/${leagueId}/player/${spot.player_id}`}
        className="flex-1 text-white text-sm font-medium truncate hover:underline"
      >
        {player?.name}
      </Link>
    </div>
  );
}
