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
