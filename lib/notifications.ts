import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push";

export type NotificationKind =
  | "trade_proposed"
  | "weekly_result"
  | "lineup_unset";

type EnqueueArgs = {
  userId: string;
  leagueId: number;
  kind: NotificationKind;
  body: string;
  link?: string | null;
};

/**
 * Inserts a notification row. If/when an email provider is configured (via
 * NOTIFICATION_EMAIL_PROVIDER), that side-channel can be dispatched here too;
 * for now this only writes the in-app record. The schema is the
 * authoritative store — the bell icon and /notifications page read from it.
 */
export async function enqueueNotification(
  admin: SupabaseClient,
  args: EnqueueArgs,
): Promise<void> {
  // Skip if the user has explicitly disabled this notification kind.
  const { data: pref } = await admin
    .from("user_notification_prefs")
    .select("enabled")
    .eq("user_id", args.userId)
    .eq("kind", args.kind)
    .maybeSingle();
  if (pref && (pref as any).enabled === false) return;

  await admin.from("notifications").insert({
    user_id: args.userId,
    league_id: args.leagueId,
    kind: args.kind,
    body: args.body,
    link: args.link ?? null,
  });

  // Web push — no-ops silently if VAPID keys aren't configured.
  try {
    await sendPushToUser(admin, args.userId, {
      title: titleFor(args.kind),
      body: args.body,
      url: args.link ?? "/notifications",
      tag: `${args.kind}-${args.leagueId}`,
    });
  } catch (e) {
    console.warn("push dispatch failed", e);
  }

  // Hook for email delivery. Wire up to Resend / SES / etc. here when a
  // provider is configured. Failures must not block the underlying action.
  if (process.env.NOTIFICATION_EMAIL_PROVIDER) {
    try {
      await dispatchEmail(args);
    } catch (e) {
      console.warn("notification email dispatch failed", e);
    }
  }
}

function titleFor(kind: NotificationKind): string {
  switch (kind) {
    case "trade_proposed": return "Trade proposed";
    case "weekly_result": return "Week finalized";
    case "lineup_unset": return "Set your lineup";
  }
}

async function dispatchEmail(_args: EnqueueArgs): Promise<void> {
  // No-op placeholder. Replace with a fetch to your provider's REST API.
  // Keep this function dependency-free so the rest of the code doesn't have
  // to know which provider is in play.
}
