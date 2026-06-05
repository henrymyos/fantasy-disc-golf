// Shared league-setup checklist logic. Drives both the onboarding card on the
// league home and the commissioner dashboard so a first-time commissioner has
// one guided path: invite → schedule → divisions/matchups → scoring → draft.

export type SetupSignals = {
  memberCount: number;
  maxTeams: number | null;
  scheduleConfigured: boolean; // selected_event_slugs explicitly chosen
  matchupsGenerated: boolean; // at least one matchup row exists
  scoringConfigured: boolean; // custom scoring_rules saved
  draftStatus: string | null; // drafts.status
  draftScheduledAt: string | null; // drafts.scheduled_at
};

export type SetupStep = {
  key: string;
  label: string;
  detail: string;
  href: string; // relative to /league/[id]
  done: boolean;
};

export function computeSetupSteps(base: string, s: SetupSignals): SetupStep[] {
  const draftComplete = s.draftStatus === "complete";
  const draftScheduled = !!s.draftScheduledAt || s.draftStatus === "in_progress";

  return [
    {
      key: "invite",
      label: "Invite your league",
      detail:
        s.maxTeams != null
          ? `${s.memberCount}/${s.maxTeams} teams joined`
          : `${s.memberCount} team${s.memberCount === 1 ? "" : "s"} joined`,
      href: `${base}/settings`,
      done: s.memberCount >= 2,
    },
    {
      key: "schedule",
      label: "Choose your season schedule",
      detail: s.scheduleConfigured ? "Schedule selected" : "Pick which events count",
      href: `${base}/settings/season`,
      done: s.scheduleConfigured,
    },
    {
      key: "divisions",
      label: "Set divisions & generate matchups",
      detail: s.matchupsGenerated ? "Matchups generated" : "No matchups yet",
      href: `${base}/settings/divisions`,
      done: s.matchupsGenerated,
    },
    {
      key: "scoring",
      label: "Review scoring rules",
      detail: s.scoringConfigured ? "Custom rules saved" : "Using default scoring",
      href: `${base}/settings/scoring`,
      done: s.scoringConfigured,
    },
    {
      key: "draft",
      label: "Run your draft",
      detail: draftComplete
        ? "Draft complete"
        : draftScheduled
          ? "Draft scheduled"
          : "Set order & start",
      href: `${base}/draft`,
      done: draftComplete,
    },
  ];
}

export function setupProgress(steps: SetupStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}
