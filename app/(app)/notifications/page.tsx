import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";
import { markAllNotificationsRead } from "@/actions/notifications";

export const dynamic = "force-dynamic";

const KINDS = [
  {
    kind: "trade_proposed" as const,
    label: "Trade proposed to you",
    description: "When another team sends you a trade.",
  },
  {
    kind: "weekly_result" as const,
    label: "Weekly result",
    description: "When the commissioner finalizes the week — win or lose.",
  },
  {
    kind: "lineup_unset" as const,
    label: "Lineup reminder",
    description: "If you have empty starter slots within ~6 hours of round-1 tee time.",
  },
];

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

  const { data: prefs } = await supabase
    .from("user_notification_prefs")
    .select("kind, enabled")
    .eq("user_id", user.id);
  const byKind = new Map<string, boolean>(
    (prefs ?? []).map((p: any) => [p.kind, p.enabled]),
  );

  return (
    <div className="max-w-2xl space-y-5">
      <BackLink fallbackHref="/dashboard" />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white font-bold text-xl">Notifications</h2>
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

      <div className="pt-2">
        <h3 className="text-white font-bold text-sm">Settings</h3>
        <p className="text-gray-400 text-sm mt-1">
          Turn off any of these to stop creating new in-app notifications of that kind. Existing notifications stay in your feed.
        </p>
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        {KINDS.map(({ kind, label, description }) => {
          const enabled = byKind.has(kind) ? !!byKind.get(kind) : true;
          return (
            <NotificationPrefToggle
              key={kind}
              kind={kind}
              enabled={enabled}
              label={label}
              description={description}
            />
          );
        })}
      </div>

      <div className="bg-[#1a1d23] rounded-2xl p-4 border border-white/5">
        <p className="text-gray-400 text-xs leading-relaxed">
          This is a website, not a native app. Notifications show up in the
          in-app feed when you open the site. Email and push delivery aren&apos;t
          wired up — to add email, plug a provider into{" "}
          <code className="text-gray-300">lib/notifications.ts:dispatchEmail</code>.
        </p>
      </div>
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
