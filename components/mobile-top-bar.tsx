"use client";

import Link from "next/link";
import { ThemeToggleIcon } from "@/components/theme-toggle-icon";

export function MobileTopBar({ username, logoutAction }: { username: string; logoutAction: () => Promise<void> }) {
  return (
    <header className="md:hidden bg-[#13151c] border-b border-white/5 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
      <Link href="/dashboard" className="shrink-0 flex items-center gap-1.5">
        <div className="w-7 h-7 bg-[#4B3DFF] rounded-lg flex items-center justify-center text-white font-black text-xs">
          DF
        </div>
        <span className="text-white font-black text-sm">Disc Fantasy</span>
      </Link>
      <div className="flex-1" />
      <ThemeToggleIcon />
      <div className="w-7 h-7 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-xs font-bold shrink-0">
        {username?.[0]?.toUpperCase() ?? "?"}
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition"
          title="Sign out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </form>
    </header>
  );
}
