import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push";

export type NotificationKind =
  | "trade_proposed"
  | "weekly_result"
  | "lineup_unset"
  | "waiver_result"
  | "member_joined"
  | "draft_status";

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

  // Email side-channel via Resend. No-ops unless RESEND_API_KEY + a verified
  // from-address are configured. Failures must not block the underlying action.
  if (process.env.RESEND_API_KEY && process.env.NOTIFICATION_EMAIL_FROM) {
    try {
      await dispatchEmail(admin, args);
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
    case "waiver_result": return "Waiver result";
    case "member_joined": return "New member";
    case "draft_status": return "Draft update";
  }
}

/** Absolute base URL for links in emails (no request context in cron). */
function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

/** Sends one notification email via Resend's REST API (no SDK dependency). */
async function dispatchEmail(admin: SupabaseClient, args: EnqueueArgs): Promise<void> {
  const { data, error } = await admin.auth.admin.getUserById(args.userId);
  const email = data?.user?.email;
  if (error || !email) return;

  const subject = titleFor(args.kind);
  const href = `${siteUrl()}${args.link ?? "/notifications"}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f1117">
      <h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(subject)}</h2>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#374151">${escapeHtml(args.body)}</p>
      <a href="${href}" style="display:inline-block;background:#4B3DFF;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px">Open Disc Fantasy</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">You can turn these emails off in Notification Settings.</p>
    </div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.NOTIFICATION_EMAIL_FROM,
      to: email,
      subject: `Disc Fantasy — ${subject}`,
      html,
    }),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
