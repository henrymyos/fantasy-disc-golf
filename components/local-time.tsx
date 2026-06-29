"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO timestamp formatted in the *viewer's* own timezone.
 *
 * Server components must not format timestamps with toLocaleString: the server
 * runs in UTC, so a draft set for 8pm ET would render as "1am" the next day.
 * Formatting is deferred to the browser, where the user's timezone is known.
 * The text is filled in after mount, so SSR and the first client render both
 * emit an empty span — no hydration mismatch, then it swaps to the local time.
 */
export function LocalTime({
  iso,
  options,
}: {
  iso: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString("en-US", options));
    // options is a stable literal at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}
