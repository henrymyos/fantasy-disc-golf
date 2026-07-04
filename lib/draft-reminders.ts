import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification } from "@/lib/notifications";

// Pre-draft reminders: a heads-up to the whole league ~1 day and ~1 hour before
// a scheduled draft. Idempotent via the reminder_1d_sent / reminder_1h_sent flags
// on drafts (reset in scheduleDraft whenever the time is set), so a frequent cron
// sweep never repeats a reminder. Admin client, no auth — callers are the
// CRON_SECRET-gated routes.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function runDraftReminders(admin: SupabaseClient): Promise<{ sent: number }> {
  const now = Date.now();
  const { data: drafts } = await admin
    .from("drafts")
    .select("id, league_id, scheduled_at, reminder_1d_sent, reminder_1h_sent")
    .eq("status", "pending")
    .not("scheduled_at", "is", null);

  let sent = 0;
  for (const d of drafts ?? []) {
    const startMs = Date.parse((d as any).scheduled_at);
    if (!Number.isFinite(startMs)) continue;
    const until = startMs - now;
    if (until <= 0) continue; // its (informational) time has passed; commissioner still starts manually

    // Final hour — send the 1-hour reminder (and don't also fire the day one).
    if (until <= HOUR_MS) {
      if (!(d as any).reminder_1h_sent) {
        await notifyLeague(admin, (d as any).league_id, "The draft starts within the hour — get ready!");
        await admin.from("drafts").update({ reminder_1h_sent: true }).eq("id", (d as any).id);
        sent++;
      }
      continue;
    }

    // Within a day (but more than an hour out) — send the 1-day reminder.
    if (until <= DAY_MS && !(d as any).reminder_1d_sent) {
      await notifyLeague(admin, (d as any).league_id, "The draft starts within a day — get your rankings set.");
      await admin.from("drafts").update({ reminder_1d_sent: true }).eq("id", (d as any).id);
      sent++;
    }
  }
  return { sent };
}

async function notifyLeague(admin: SupabaseClient, leagueId: number, body: string): Promise<void> {
  const { data: members } = await admin
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);
  for (const m of members ?? []) {
    const uid = (m as any).user_id;
    if (!uid) continue;
    await enqueueNotification(admin, {
      userId: uid,
      leagueId,
      kind: "draft_status",
      body,
      link: `/league/${leagueId}/draft`,
    });
  }
}
