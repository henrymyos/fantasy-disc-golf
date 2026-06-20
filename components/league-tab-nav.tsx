"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Spinner that appears while its parent <Link> is navigating, so a tapped tab
 * visibly shows it's loading (and the user doesn't tap again). Absolutely
 * positioned so it adds no width — the tabs stay narrow enough to fit. Must
 * live inside a `relative` <Link>.
 */
function TabSpinner() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-current border-t-transparent transition-opacity ${
        pending ? "opacity-70 animate-spin" : "opacity-0"
      }`}
    />
  );
}

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
    <nav className="mb-6 border-b border-white/5 sticky top-[calc(env(safe-area-inset-top)+42px)] md:top-0 z-20 bg-[var(--background)] -mx-4 px-4 md:-mx-0 md:px-0 before:content-[''] before:absolute before:bottom-full before:left-0 before:right-0 before:h-1.5 before:bg-[var(--background)] md:before:hidden">
      {/* Inner element owns the horizontal scroll so the sticky <nav> itself
          keeps overflow:visible — otherwise the gap-filling ::before above it
          would get clipped. */}
      <div className="flex w-full gap-0.5 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const href = `${base}${tab.href}`;
          const isActive = pathname === href;
          return (
            <Link
              key={tab.href}
              href={href}
              ref={isActive ? activeRef : undefined}
              className={`relative flex-1 md:flex-none min-h-[44px] px-2.5 md:px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap -mb-px flex items-center justify-center md:justify-start ${
                isActive
                  ? "text-white border-[#4B3DFF]"
                  : "text-gray-300 hover:text-white border-transparent hover:border-[#4B3DFF]"
              }`}
            >
              {tab.label}
              <TabSpinner />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
