import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { archiveSeason } from "@/actions/archives";

export const dynamic = "force-dynamic";

export default async function ArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, commissioner_id")
    .eq("id", id)
    .single();
  if (!league) notFound();
  const isCommissioner = (league as any).commissioner_id === user.id;

  const { data: member } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", id)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect(`/league/${id}`);

  const { data: archives } = await supabase
    .from("season_archives")
    .select("season_year, payload, created_at")
    .eq("league_id", id)
    .order("season_year", { ascending: false });

  const years = (archives ?? []).map((a: any) => a.season_year as number);
  const selectedYear = sp.year ? Number(sp.year) : years[0];
  const current = (archives ?? []).find((a: any) => a.season_year === selectedYear);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/league/${id}`}
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← League
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-white font-bold text-xl">Season Archive</h2>
          {isCommissioner && (
            <form
              action={async () => {
                "use server";
                await archiveSeason(Number(id));
              }}
            >
              <button
                type="submit"
                className="text-xs bg-[#4B3DFF]/15 hover:bg-[#4B3DFF]/25 border border-[#4B3DFF]/30 text-[#4B3DFF] hover:text-white font-semibold px-4 py-2 rounded-lg transition"
              >
                Snapshot current season
              </button>
            </form>
          )}
        </div>
        <p className="text-gray-400 text-sm mt-1">
          Snapshots of final standings, rosters, and the draft for each completed season.
        </p>
      </div>

      {years.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">
            No archived seasons yet. The commissioner can take a snapshot from League Settings
            when the season ends.
          </p>
        </div>
      ) : (
        <>
          {years.length > 1 && (
            <div className="flex gap-1 bg-[#1a1d23] border border-white/5 rounded-xl p-1 w-fit">
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/league/${id}/archive?year=${y}`}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                    y === selectedYear
                      ? "bg-[#4B3DFF] text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          )}

          {current && <ArchiveDetails archive={current as any} />}
        </>
      )}
    </div>
  );
}

function ArchiveDetails({
  archive,
}: {
  archive: { season_year: number; payload: any; created_at: string };
}) {
  const p = archive.payload as {
    standings: Array<{ teamId: number; teamName: string; wins: number; losses: number; points: number }>;
    rosters: Array<{ teamId: number; teamName: string; players: Array<{ name: string; division: string; isStarter: boolean }> }>;
    draft: null | { type: string; totalRounds: number; picks: Array<{ pickNumber: number; round: number; teamId: number; playerName: string; division: string }> };
    scoringMode: string;
    snapshotAt: string;
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h3 className="text-white font-bold mb-3">Final Standings ({archive.season_year})</h3>
        <ol className="space-y-1">
          {p.standings.map((t, i) => (
            <li
              key={t.teamId}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-sm font-bold w-6 ${i === 0 ? "text-[#36D7B7]" : i === 1 ? "text-gray-300" : i === 2 ? "text-[#F5A524]" : "text-gray-400"}`}>
                  {i + 1}
                </span>
                <span className="text-white text-sm font-medium truncate">{t.teamName}</span>
              </div>
              <div className="text-right">
                <span className="text-white text-sm font-semibold">{t.wins}-{t.losses}</span>
                <span className="text-gray-400 text-xs ml-2">{t.points.toFixed(0)} pts</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5">
          <h3 className="text-white font-bold">Final Rosters</h3>
        </div>
        <div className="divide-y divide-white/5">
          {p.rosters.map((r) => (
            <div key={r.teamId} className="px-5 py-3">
              <p className="text-white font-semibold text-sm mb-2">{r.teamName}</p>
              <div className="flex flex-wrap gap-1.5">
                {r.players.map((pl, i) => {
                  const color = pl.division === "MPO" ? "#4B3DFF" : "#36D7B7";
                  return (
                    <span
                      key={i}
                      className={`text-xs px-2 py-0.5 rounded ${pl.isStarter ? "" : "opacity-60"}`}
                      style={{
                        color: pl.isStarter ? "#fff" : color,
                        background: pl.isStarter ? color : `${color}20`,
                      }}
                      title={pl.isStarter ? "Starter" : "Bench"}
                    >
                      {pl.name}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {p.draft && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-white font-bold mb-3">
            Draft Recap ({p.draft.type} · {p.draft.totalRounds} rounds)
          </h3>
          <ol className="space-y-1 max-h-[400px] overflow-y-auto">
            {p.draft.picks.map((pick) => (
              <li key={pick.pickNumber} className="flex items-center gap-3 px-2 py-1 text-sm">
                <span className="text-gray-400 text-xs w-12 font-mono">
                  R{pick.round}.{((pick.pickNumber - 1) % Math.ceil(p.draft!.picks.length / p.draft!.totalRounds)) + 1}
                </span>
                <span className="text-white truncate">{pick.playerName}</span>
                <span
                  className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                  style={{
                    color: pick.division === "MPO" ? "#4B3DFF" : "#36D7B7",
                    background: pick.division === "MPO" ? "#4B3DFF20" : "#36D7B720",
                  }}
                >
                  {pick.division}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-gray-400 text-xs text-right">
        Snapshot taken {new Date(p.snapshotAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </p>
    </div>
  );
}
