"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", icon: "🏠", label: "Leagues" },
  { href: "/pro-tour", icon: "🥏", label: "Pro Tour" },
];

export function MobileTopBar({ username, logoutAction }: { username: string; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <header className="md:hidden bg-[#13151c] border-b border-white/5 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
      <Link href="/dashboard" className="shrink-0">
        <span className="text-[#4B3DFF] font-black text-lg">D</span>
        <span className="text-white font-black text-lg">F</span>
      </Link>
      <div className="flex items-center gap-1 overflow-x-auto flex-1">
        {NAV_ITEMS.map(({ href, icon, label }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition shrink-0 ${
              pathname === href
                ? "bg-[#4B3DFF]/20 text-white border border-[#4B3DFF]/30"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-xs font-bold">
          {username?.[0]?.toUpperCase() ?? "?"}
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-xs text-gray-400 hover:text-white font-medium px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition whitespace-nowrap"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
