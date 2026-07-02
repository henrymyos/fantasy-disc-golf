"use client";

import { useEffect } from "react";

/**
 * Records the league the user is currently viewing in a cookie so that the
 * next time they open the app they land straight back on it (see
 * lib/landing.ts). Renders nothing.
 */
export function RememberLastLeague({ id }: { id: number | string }) {
  useEffect(() => {
    // 1 year, lax so it rides along on top-level navigations to "/".
    document.cookie = `last_league_id=${id}; path=/; max-age=31536000; SameSite=Lax`;
  }, [id]);
  return null;
}
