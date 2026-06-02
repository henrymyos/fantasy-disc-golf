import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { markAllNotificationsRead } from "@/actions/notifications";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, kind, body, link, read_at, created_at, league_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const unreadCount = (notifications ?? []).filter((n: any) => n.read_at == null).length;

  return (
    <div className="max-w-2xl space-y-5">
      <BackLink fallbackHref="/dashboard" />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white font-bold text-xl">Notifications</h2>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <form action={markAllNotificationsRead}>
              <button
                type="submit"
                className="text-xs text-[#4B3DFF] border border-[#4B3DFF]/40 hover:border-[#4B3DFF] hover:bg-[#4B3DFF]/10 px-3 py-1.5 rounded-full transition"
              >
                Mark all read
              </button>
            </form>
          )}
          <Link
            href="/notifications/settings"
            aria-label="Notification settings"
            title="Notification settings"
            className="text-gray-400 hover:text-white p-1.5 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/5 transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </div>

      {(notifications ?? []).length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">Nothing here yet.</p>
        </div>
      ) : (
        <ul className="bg-[#1a1d23] rounded-2xl border border-white/5 divide-y divide-white/5 overflow-hidden">
          {notifications!.map((n: any) => (
            <li
              key={n.id}
              className={`px-5 py-4 flex items-start gap-3 ${n.read_at == null ? "bg-[#4B3DFF]/5" : ""}`}
            >
              <span
                className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={iconStyleFor(n.kind)}
              >
                {iconFor(n.kind)}
              </span>
              <div className="min-w-0 flex-1">
                {n.link ? (
                  <Link href={n.link} className="text-white text-sm leading-snug hover:underline block">
                    {n.body}
                  </Link>
                ) : (
                  <p className="text-white text-sm leading-snug">{n.body}</p>
                )}
                <p className="text-gray-400 text-[10px] mt-1">
                  {new Date(n.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {n.read_at == null && (
                <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-[#4B3DFF]" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function iconFor(kind: string): string {
  switch (kind) {
    case "trade_proposed": return "⇄";
    case "weekly_result": return "🏁";
    case "lineup_unset": return "!";
    default: return "•";
  }
}

function iconStyleFor(kind: string): React.CSSProperties {
  switch (kind) {
    case "trade_proposed":
      return { background: "rgba(75,61,255,0.18)", color: "#a09aff" };
    case "weekly_result":
      return { background: "rgba(54,215,183,0.15)", color: "#36D7B7" };
    case "lineup_unset":
      return { background: "rgba(245,165,36,0.18)", color: "#F5A524" };
    default:
      return { background: "rgba(255,255,255,0.06)", color: "#9ca3af" };
  }
}
