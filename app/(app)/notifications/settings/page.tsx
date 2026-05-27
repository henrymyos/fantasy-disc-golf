import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";

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

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: prefs } = await supabase
    .from("user_notification_prefs")
    .select("kind, enabled")
    .eq("user_id", user.id);
  const byKind = new Map<string, boolean>(
    (prefs ?? []).map((p: any) => [p.kind, p.enabled]),
  );

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href="/notifications"
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        >
          ← Notifications
        </Link>
        <h2 className="text-white font-bold text-xl">Notification Settings</h2>
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
