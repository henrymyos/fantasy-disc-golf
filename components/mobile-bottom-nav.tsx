"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type LeagueLink = { id: number; name: string; logoUrl: string | null };

export function MobileBottomNav({ leagues = [] }: { leagues?: LeagueLink[] }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lock body scroll while the leagues sheet is open. (Selecting a league or
  // tapping the backdrop closes the sheet directly, so no route-change effect
  // is needed.)
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const onLeagues = pathname.startsWith("/league/");
  const onHome = pathname === "/dashboard";
  const onProTour = pathname.startsWith("/pro-tour");

  const tabClass = (active: boolean) =>
    `flex flex-col items-center gap-0.5 flex-1 py-2 text-[10px] font-semibold transition ${
      active ? "text-[#4B3DFF]" : "text-gray-400 hover:text-white"
    }`;

  return (
    <>
      {/* Leagues sheet — the mobile counterpart of the sidebar "My Leagues". */}
      {sheetOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close leagues"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-[#13151c] border-t border-white/10 rounded-t-2xl max-h-[70vh] flex flex-col pb-[max(env(safe-area-inset-bottom),1rem)]">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
              <p className="text-white font-bold text-sm uppercase tracking-wider text-gray-300">My Leagues</p>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-white transition p-1 -mr-1"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto overscroll-none px-2 pb-2 space-y-1">
              {leagues.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8 px-4">
                  You&apos;re not in any leagues yet.
                </p>
              ) : (
                leagues.map((lg) => {
                  const href = `/league/${lg.id}`;
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <Link
                      key={lg.id}
                      href={href}
                      onClick={() => setSheetOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                        active
                          ? "bg-[#4B3DFF]/20 text-white border border-[#4B3DFF]/30"
                          : "text-gray-300 hover:bg-white/5"
                      }`}
                    >
                      {lg.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={lg.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0 bg-white/10" />
                      ) : (
                        <span className="w-8 h-8 rounded-lg bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-[#4B3DFF] font-black text-sm shrink-0">
                          {lg.name?.[0]?.toUpperCase() ?? "?"}
                        </span>
                      )}
                      <span className="font-semibold text-sm truncate">{lg.name}</span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#13151c]/95 backdrop-blur border-t border-white/5 flex justify-around pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1"
        aria-label="Primary"
      >
        <Link href="/dashboard?home=1" className={tabClass(onHome)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-8 9 8" />
            <path d="M5 9v11h14V9" />
          </svg>
          <span>Home</span>
        </Link>

        <button type="button" onClick={() => setSheetOpen((o) => !o)} className={tabClass(onLeagues || sheetOpen)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span>Leagues</span>
        </button>

        <Link href="/pro-tour" className={tabClass(onProTour)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v18M3 12h18" />
          </svg>
          <span>Pro Tour</span>
        </Link>
      </nav>
    </>
  );
}
