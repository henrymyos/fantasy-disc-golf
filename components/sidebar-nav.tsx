"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", icon: "🏠", label: "My Leagues" },
  { href: "/pro-tour", icon: "🥏", label: "Pro Tour" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1">
      {NAV_ITEMS.map(({ href, icon, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition text-sm font-medium ${
              isActive
                ? "bg-[#4B3DFF]/20 text-white border border-[#4B3DFF]/30"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="w-5 text-base flex items-center justify-center shrink-0">{icon}</span>
            <span className="hidden lg:block">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
