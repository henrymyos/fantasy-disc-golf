"use client";

import { useEffect, useState, useTransition } from "react";
import { subscribeToPush, unsubscribeFromPush } from "@/actions/notifications";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function PushSubscribeButton() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = useState<PushSubscription | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok = typeof window !== "undefined"
      && "serviceWorker" in navigator
      && "PushManager" in window
      && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then(setSubscribed).catch(() => {});
  }, []);

  if (supported === false) {
    return (
      <p className="text-gray-400 text-xs">
        Push notifications aren&apos;t supported in this browser.
      </p>
    );
  }

  if (!VAPID_PUBLIC) {
    return (
      <p className="text-gray-400 text-xs">
        Push isn&apos;t configured for this deployment. Set
        <code className="text-gray-300 mx-1">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>
        and the matching server-side key to enable it.
      </p>
    );
  }

  async function enable() {
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Permission denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC!);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast through ArrayBuffer because PushSubscriptionOptions's typed
        // signature is narrower than what Uint8Array<ArrayBufferLike> exposes.
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      });
      const json = sub.toJSON() as any;
      startTransition(async () => {
        await subscribeToPush({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? arrayBufferToBase64(sub.getKey("p256dh")!),
          auth: json.keys?.auth ?? arrayBufferToBase64(sub.getKey("auth")!),
          userAgent: navigator.userAgent,
        });
        setSubscribed(sub);
      });
    } catch (e: any) {
      setError(e?.message ?? "Subscribe failed");
    }
  }

  async function disable() {
    if (!subscribed) return;
    const endpoint = subscribed.endpoint;
    startTransition(async () => {
      try {
        await subscribed.unsubscribe();
      } catch {}
      await unsubscribeFromPush(endpoint);
      setSubscribed(null);
    });
  }

  return (
    <div className="space-y-2">
      {subscribed ? (
        <button
          type="button"
          onClick={disable}
          disabled={pending}
          className="text-xs border border-white/10 hover:border-white/30 text-gray-300 hover:text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
        >
          {pending ? "..." : "Disable push on this device"}
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={pending || permission === "denied"}
          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
        >
          {pending ? "..." : permission === "denied" ? "Push blocked in browser settings" : "Enable push on this device"}
        </button>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
