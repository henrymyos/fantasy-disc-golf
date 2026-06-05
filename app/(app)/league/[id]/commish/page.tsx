import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeSetupSteps, setupProgress } from "@/lib/league-setup";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

export default async function CommishDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, name, commissioner_id, max_teams, current_week, selected_event_slugs, scoring_rules, scoring_mode, dues_amount, waivers_locked, keepers_per_team",
    )
    .eq("id", id)
    .single();
  if (!league) notFound();
  if ((league as any).commissioner_id !== user.id) redirect(`/league/${id}/settings`);

  const base = `/league/${id}`;

  const [
    { data: members },
    { data: draft },
    { count: matchupCount },
    { count: pendingWaivers },
    { count: pendingTrades },
  ] = await Promise.all([
    supabase
      .from("league_members")
      .select("id, team_name, dues_paid, is_commissioner, division_name, profiles(username)")
      .eq("league_id", id)
      .order("joined_at"),
    supabase.from("drafts").select("status, scheduled_at").eq("league_id", id).maybeSingle(),
    supabase.from("matchups").select("id", { count: "exact", head: true }).eq("league_id", id),
    supabase.from("waiver_claims").select("id", { count: "exact", head: true }).eq("league_id", id).eq("status", "pending"),
    supabase.from("trades").select("id", { count: "exact", head: true }).eq("league_id", id).eq("status", "pending"),
  ]);

  const memberList = members ?? [];
  const memberCount = memberList.length;
  const duesAmount = (league as any).dues_amount as number | null;
  const paidCount = memberList.filter((m: any) => m.dues_paid).length;
  const hasDivisions = memberList.some((m: any) => !!m.division_name);

  const steps = computeSetupSteps(base, {
    memberCount,
    maxTeams: (league as any).max_teams ?? null,
    scheduleConfigured: (league as any).selected_event_slugs != null,
    matchupsGenerated: (matchupCount ?? 0) > 0,
    scoringConfigured: (league as any).scoring_rules != null,
    draftStatus: (draft as any)?.status ?? null,
    draftScheduledAt: (draft as any)?.scheduled_at ?? null,
  });
  const progress = setupProgress(steps);

  // Current week's tournament name(s).
  const currentWeek = (league as any).current_week as number;
  const { data: weekTournaments } = await supabase
    .from("tournaments")
    .select("name")
    .eq("week", currentWeek);
  const weekEventName = (weekTournaments ?? []).map((t: any) => t.name).join(", ") || "No event this week";

  const draftStatus = (draft as any)?.status ?? "pending";
  const draftLabel =
    draftStatus === "complete" ? "Complete" : draftStatus === "in_progress" ? "In progress" : "Not started";
  const scoringModeLabel: Record<string, string> = {
    head_to_head: "Head-to-head",
    all_play: "All-play",
    median: "Median",
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Commissioner Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Run {(league as any).name} from one place.</p>
      </div>

      {!progress.complete && <OnboardingChecklist steps={steps} />}

      {/* League snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Week" value={String(currentWeek)} sub={weekEventName} />
        <Stat label="Teams" value={`${memberCount}${(league as any).max_teams ? `/${(league as any).max_teams}` : ""}`} sub={hasDivisions ? "Divisions set" : "No divisions"} />
        <Stat label="Draft" value={draftLabel} />
        <Stat label="Scoring" value={scoringModeLabel[(league as any).scoring_mode] ?? "—"} />
      </div>

      {/* Needs attention */}
      {((pendingWaivers ?? 0) > 0 || (pendingTrades ?? 0) > 0 || (duesAmount != null && paidCount < memberCount)) && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-yellow-400/20">
          <h2 className="font-bold text-white mb-3">Needs attention</h2>
          <div className="space-y-2">
            {duesAmount != null && paidCount < memberCount && (
              <AttentionRow
                href={`${base}/settings/dues`}
                label="Dues outstanding"
                detail={`${memberCount - paidCount} of ${memberCount} teams haven't paid`}
              />
            )}
            {(pendingTrades ?? 0) > 0 && (
              <AttentionRow
                href={`${base}/trades`}
                label="Pending trades"
                detail={`${pendingTrades} awaiting a response`}
              />
            )}
            {(pendingWaivers ?? 0) > 0 && (
              <AttentionRow
                href={`${base}/free-agency`}
                label="Waiver claims queued"
                detail={`${pendingWaivers} claim${pendingWaivers === 1 ? "" : "s"} will process on the next run`}
              />
            )}
          </div>
        </div>
      )}

      {/* Dues summary */}
      {duesAmount != null && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-white">Dues</h2>
            <Link href={`${base}/settings/dues`} className="text-[#a09aff] text-sm hover:text-white transition">
              Manage →
            </Link>
          </div>
          <p className="text-gray-400 text-sm">
            <span className="text-white font-semibold">{paidCount}</span> of {memberCount} paid
            {" · "}
            <span className="text-white font-semibold">${(paidCount * duesAmount).toFixed(0)}</span> of ${(memberCount * duesAmount).toFixed(0)} collected
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {memberList.map((m: any) => (
              <span
                key={m.id}
                className={`text-[11px] px-2 py-1 rounded-full border ${
                  m.dues_paid
                    ? "border-[#36D7B7]/30 bg-[#36D7B7]/10 text-[#36D7B7]"
                    : "border-red-400/30 bg-red-400/10 text-red-300"
                }`}
                title={m.dues_paid ? "Paid" : "Unpaid"}
              >
                {m.dues_paid ? "✓" : "•"} {m.team_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <h2 className="font-bold text-white mb-3">Manage league</h2>
        <div className="grid grid-cols-2 gap-2">
          <QuickLink href={`${base}/settings/league`} label="League settings" />
          <QuickLink href={`${base}/settings/members`} label="Members" />
          <QuickLink href={`${base}/settings/season`} label="Season schedule" />
          <QuickLink href={`${base}/settings/divisions`} label="Divisions & matchups" />
          <QuickLink href={`${base}/settings/rosters`} label="Rosters" />
          <QuickLink href={`${base}/settings/scoring`} label="Scoring rules" />
          <QuickLink href={`${base}/scoring`} label="Enter / finalize results" />
          <QuickLink href={`${base}/settings/dues`} label="Dues & payouts" />
          {(league as any).keepers_per_team > 0 && (
            <QuickLink href={`${base}/settings/keepers`} label="Keepers" />
          )}
          <QuickLink href={`${base}/settings/season-rollover`} label="Start next season" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#1a1d23] rounded-2xl border border-white/5 p-4">
      <p className="text-gray-400 text-[11px] uppercase tracking-wider">{label}</p>
      <p className="text-white font-bold text-lg leading-tight mt-1 truncate">{value}</p>
      {sub && <p className="text-gray-500 text-[11px] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function AttentionRow({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 bg-[#0f1117] border border-white/5 hover:border-white/15 transition"
    >
      <div className="min-w-0">
        <p className="text-white text-sm font-medium">{label}</p>
        <p className="text-gray-400 text-xs truncate">{detail}</p>
      </div>
      <span className="text-yellow-300 text-sm shrink-0">→</span>
    </Link>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 bg-[#0f1117] border border-white/5 hover:border-white/15 text-sm text-white transition"
    >
      <span className="truncate">{label}</span>
      <span className="text-gray-400 shrink-0">→</span>
    </Link>
  );
}
