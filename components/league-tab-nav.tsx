"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_TABS = [
  { label: "Dashboard", href: "" },
  { label: "Matchups", href: "/matchups" },
  { label: "Team", href: "/lineups" },
  { label: "Free Agency", href: "/free-agency" },
  { label: "Draft", href: "/draft" },
  { label: "Settings", href: "/settings" },
];

export function LeagueTabNav({ base, isCommissioner, draftComplete }: { base: string; isCommissioner: boolean; draftComplete?: boolean }) {
  const pathname = usePathname();

  const tabs = NAV_TABS.filter((t) => !(t.href === "/draft" && draftComplete));

  return (
    <nav className="flex gap-1 mb-6 border-b border-white/5 pb-0 -mx-0 overflow-x-auto">
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
