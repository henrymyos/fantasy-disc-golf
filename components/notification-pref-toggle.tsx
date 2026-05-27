"use client";

import { useTransition } from "react";
import { setNotificationPref } from "@/actions/notifications";
import type { NotificationKind } from "@/lib/notifications";

export function NotificationPrefToggle({
  kind,
  enabled,
  label,
  description,
}: {
  kind: NotificationKind;
  enabled: boolean;
  label: string;
  description: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await setNotificationPref(kind, !enabled);
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 border-b border-white/5 last:border-0">
      <div className="min-w-0">
        <p className="text-white text-sm font-medium">{label}</p>
        <p className="text-gray-400 text-xs mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        role="switch"
        aria-checked={enabled}
        className={`relative shrink-0 inline-flex h-6 w-11 rounded-full transition disabled:opacity-50 ${
          enabled ? "bg-[#4B3DFF]" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
