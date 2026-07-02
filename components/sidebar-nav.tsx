"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type LeagueLink = { id: number; name: string; logoUrl: string | null };

const NAV_ITEMS = [
  { href: "/dashboard?home=1", icon: "🏠", label: "Home" },
  { href: "/pro-tour", icon: "🥏", label: "Pro Tour" },
];

const linkClass = (isActive: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg transition text-sm font-medium ${
    isActive
      ? "bg-[#4B3DFF]/20 text-white border border-[#4B3DFF]/30"
      : "text-gray-400 hover:text-white hover:bg-white/5"
  }`;

export function SidebarNav({ leagues = [] }: { leagues?: LeagueLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 min-h-0 overflow-y-auto space-y-1">
      {NAV_ITEMS.map(({ href, icon, label }) => (
        <Link key={href} href={href} className={linkClass(pathname === href.split("?")[0])}>
          <span className="w-5 text-base flex items-center justify-center shrink-0">{icon}</span>
          <span className="hidden lg:block">{label}</span>
        </Link>
      ))}

      {leagues.length > 0 && (
        <div className="pt-4">
          <p className="hidden lg:block px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            My Leagues
          </p>
          {/* Collapsed (md) width has no room for the label — show a rule. */}
          <div className="lg:hidden mx-3 mb-2 border-t border-white/5" />
          <div className="space-y-1">
            {leagues.map((lg) => {
              const href = `/league/${lg.id}`;
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link key={lg.id} href={href} title={lg.name} className={linkClass(isActive)}>
                  {lg.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lg.logoUrl}
                      alt=""
                      className="w-5 h-5 rounded object-cover shrink-0 bg-white/10"
                    />
                  ) : (
                    <span className="w-5 h-5 rounded bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-[#4B3DFF] font-black text-[10px] shrink-0">
                      {lg.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="hidden lg:block truncate">{lg.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
