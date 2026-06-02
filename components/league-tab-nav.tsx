"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const NAV_TABS = [
  { label: "League", href: "" },
  { label: "Team", href: "/lineups" },
  { label: "Matchup", href: "/matchup" },
  { label: "Players", href: "/free-agency" },
  { label: "Draft", href: "/draft" },
  { label: "Playoffs", href: "/playoffs" },
];

export function LeagueTabNav({ base, isCommissioner, draftComplete }: { base: string; isCommissioner: boolean; draftComplete?: boolean }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  const tabs = NAV_TABS.filter((t) => {
    if (t.href === "/draft" && draftComplete) return false;
    if (t.href === "/playoffs" && !draftComplete) return false;
    if (t.href === "/matchup" && !draftComplete) return false;
    return true;
  });

  // Pull the active tab into view on mobile so right-edge tabs (Draft,
  // Playoffs) aren't clipped off-screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pathname]);

  return (
    <nav className="flex gap-1 mb-6 border-b border-white/5 pb-0 overflow-x-auto no-scrollbar sticky top-[calc(env(safe-area-inset-top)+57px)] md:top-0 z-20 bg-[var(--background)] -mx-4 px-4 md:-mx-0 md:px-0">
      {tabs.map((tab) => {
        const href = `${base}${tab.href}`;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            ref={isActive ? activeRef : undefined}
            className={`min-h-[44px] px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap -mb-px flex items-center ${
              isActive
                ? "text-white border-[#4B3DFF]"
                : "text-gray-300 hover:text-white border-transparent hover:border-[#4B3DFF]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
