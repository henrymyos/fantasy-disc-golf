import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";
import { PushSubscribeButton } from "@/components/push-subscribe-button";

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
        <BackLink
          fallbackHref="/notifications"
          label="Notifications"
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        />
        <h2 className="text-white font-bold text-xl">Notification Settings</h2>
        <p className="text-gray-400 text-sm mt-1">
          Turn off any of these to stop creating new in-app notifications of that kind. Existing notifications stay in your feed.
        </p>
      </div>

      {/* Push on this device — subscribes the browser/PWA to Web Push so
          alerts pop up even when the app is closed. */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-3">
        <div>
          <h3 className="text-white font-semibold">Push on this device</h3>
          <p className="text-gray-400 text-sm mt-1">
            Get alerts pop up on this device even when the app is closed. On iPhone or iPad you must first add
            Disc Fantasy to your Home Screen (Share → Add to Home Screen), open it from there, then enable push below.
          </p>
        </div>
        <PushSubscribeButton />
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
    </div>
  );
}
