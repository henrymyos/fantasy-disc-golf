"use client";

import Link from "next/link";
import { ProfileMenu } from "@/components/profile-menu";

export function MobileTopBar({
  username,
  email,
  unreadCount = 0,
  logoutAction,
}: {
  username: string;
  email: string | null;
  unreadCount?: number;
  logoutAction: () => Promise<void>;
}) {
  return (
    <header className="md:hidden bg-[#13151c] border-b border-white/5 flex items-center gap-3 sticky top-0 z-30 px-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <Link href="/dashboard" className="shrink-0 flex items-center gap-1.5">
        <div className="w-7 h-7 bg-[#4B3DFF] rounded-lg flex items-center justify-center text-white font-black text-xs">
          DF
        </div>
        <span className="text-white font-black text-sm">Disc Fantasy</span>
      </Link>
      <div className="flex-1" />
      <Link
        href="/notifications"
        aria-label="Notifications"
        className="relative text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[#4B3DFF] text-white text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {unreadCount}
          </span>
        )}
      </Link>
      <ProfileMenu
        username={username}
        email={email}
        logoutAction={logoutAction}
        variant="topbar"
        unreadCount={unreadCount}
      />
    </header>
  );
}
