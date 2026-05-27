import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteLeague } from "@/actions/leagues";
import { CopyButton } from "@/components/copy-button";
import { DGPT_2026_SCHEDULE, effectiveSelection, getPlayoffSlugs } from "@/lib/dgpt-2026-schedule";

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
    .select("id, name, commissioner_id, invite_code, selected_event_slugs")
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

  const { data: divData } = await supabase
    .from("leagues")
    .select("keepers_per_team")
    .eq("id", id)
    .single();
  const keepersPerTeam: number = (divData as any)?.keepers_per_team ?? 0;

  const { count: completedDraftCount } = await supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .eq("league_id", id)
    .eq("status", "complete");

  const inviteCode = (league as any).invite_code as string | null;
  const selectedSlugs = effectiveSelection((league as any).selected_event_slugs);
  const validSelected = selectedSlugs.filter((s) =>
    DGPT_2026_SCHEDULE.some((e) => e.slug === s),
  );
  const selectedCount = validSelected.length;
  const playoffCount = getPlayoffSlugs(validSelected).length;
  const totalEvents = DGPT_2026_SCHEDULE.length;

  const base = `/league/${id}/settings`;

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {inviteCode && (
          <div className="bg-[#1a1d23] rounded-2xl border border-white/5 p-4 min-h-[120px] flex flex-col justify-between">
            <p className="text-white font-bold text-base leading-tight">Invite Code</p>
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 font-mono text-white font-bold text-lg tracking-widest border border-white/10 rounded-lg px-3 py-2 bg-white/5 select-all text-center truncate">
                {inviteCode}
              </span>
              <CopyButton value={inviteCode} label="Copy invite code" />
            </div>
          </div>
        )}

        <Tile
          href={`${base}/league`}
          title="League Settings"
          subtitle={isCommissioner ? "Name, roster, scoring mode" : "View league details"}
        />

        {isCommissioner && (
          <Tile
            href={`${base}/season`}
            title="Season"
            subtitle={`${selectedCount} of ${totalEvents} events · ${playoffCount} playoff${playoffCount !== 1 ? "s" : ""}`}
          />
        )}

        {isCommissioner && (
          <Tile
            href={`${base}/divisions`}
            title="Divisions & Matchups"
            subtitle="Set divisions and edit the schedule"
          />
        )}

        {isCommissioner && (
          <Tile
            href={`${base}/rosters`}
            title="Rosters"
            subtitle="Move players between teams"
          />
        )}

        <Tile
          href={`${base}/scoring`}
          title="Scoring"
          subtitle="Points and bonus rules"
        />

        {(completedDraftCount ?? 0) > 0 && (
          <Tile
            href={`${base}/drafts`}
            title="Draft Results"
            subtitle={`${completedDraftCount} completed draft${completedDraftCount !== 1 ? "s" : ""}`}
          />
        )}

        <Tile
          href={`/league/${id}/archive`}
          title="Archive"
          subtitle="Past seasons' standings and rosters"
        />

        {keepersPerTeam > 0 && (
          <Tile
            href={`${base}/keepers`}
            title="Keepers"
            subtitle={`Up to ${keepersPerTeam} per team`}
          />
        )}
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

function Tile({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="bg-[#1a1d23] hover:bg-[#1f2329] rounded-2xl border border-white/5 hover:border-white/15 p-4 min-h-[120px] flex flex-col justify-between transition group"
    >
      <p className="text-white font-bold text-base leading-tight">{title}</p>
      <div className="flex items-end justify-between gap-2">
        {subtitle && (
          <p className="text-gray-400 text-xs leading-snug">{subtitle}</p>
        )}
        <span className="text-gray-400 group-hover:text-white text-base shrink-0 transition">→</span>
      </div>
    </Link>
  );
}
