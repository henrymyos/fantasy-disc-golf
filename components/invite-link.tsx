"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";

/**
 * Shows a friendly, shareable join link (e.g. https://site/join/AB12CD34)
 * alongside a copy button and a native share sheet on supporting devices. The
 * origin is read on the client so it's correct in every environment without
 * threading request headers through the server tree.
 */
export function InviteLink({
  code,
  leagueName,
  className = "",
}: {
  code: string;
  leagueName?: string;
  className?: string;
}) {
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  const link = origin ? `${origin}/join/${code}` : `/join/${code}`;
  const display = link.replace(/^https?:\/\//, "");

  async function share() {
    try {
      await navigator.share({
        title: leagueName ? `Join ${leagueName}` : "Join my league",
        text: leagueName
          ? `Join my fantasy disc golf league "${leagueName}".`
          : "Join my fantasy disc golf league.",
        url: link,
      });
    } catch {
      // User dismissed the share sheet, or it's unavailable — ignore.
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-gray-300 text-sm border border-white/10 rounded-lg px-3 py-2 bg-white/5 select-all truncate">
          {display}
        </span>
        <CopyButton value={link} label="Copy invite link" />
        {canShare && (
          <button
            type="button"
            onClick={share}
            aria-label="Share invite link"
            title="Share invite link"
            className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
