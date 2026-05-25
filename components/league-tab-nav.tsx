"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  const tabs = NAV_TABS.filter((t) => {
    if (t.href === "/draft" && draftComplete) return false;
    if (t.href === "/playoffs" && !draftComplete) return false;
    if (t.href === "/matchup" && !draftComplete) return false;
    return true;
  });

  return (
    <nav className="flex gap-1 mb-6 border-b border-white/5 pb-0 overflow-x-auto sticky top-[57px] md:top-0 z-20 bg-[var(--background)] -mx-4 px-4 md:-mx-0 md:px-0">
      {tabs.map((tab) => {
        const href = `${base}${tab.href}`;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap -mb-px ${
              isActive
                ? "text-white border-[#4B3DFF]"
                : "text-gray-400 hover:text-white border-transparent hover:border-[#4B3DFF]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
