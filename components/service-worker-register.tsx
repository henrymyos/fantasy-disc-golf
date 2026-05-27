"use client";

import { useEffect } from "react";

/** Registers /sw.js once per session. Safe to mount globally. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failures are non-fatal — push just won't work.
    });
  }, []);

  return null;
}
