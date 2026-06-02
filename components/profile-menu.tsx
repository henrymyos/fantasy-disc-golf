"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

type Theme = "dark" | "light";
type Variant = "sidebar" | "topbar";

/**
 * Clickable avatar that opens a user-settings popover: appearance (light/dark),
 * a link to notification settings, and sign out. Used in both the desktop
 * sidebar (opens upward) and the mobile top bar (opens downward).
 */
export function ProfileMenu({
  username,
  email,
  logoutAction,
  variant,
  unreadCount = 0,
}: {
  username: string;
  email: string | null;
  logoutAction: () => Promise<void>;
  variant: Variant;
  unreadCount?: number;
}) {
  const [open, setOpen] = useState(false);
  // Read the active theme from the same store the toggles use. Lazy init (not
  // an effect) is safe: the only theme-dependent UI is the popover, which is
  // closed on first render, so there's no hydration mismatch.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("theme") === "light" ? "light" : "dark";
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const initial = username?.[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyTheme(next: Theme) {
    setTheme(next);
    // Dark is the default and carries no attribute; light is explicit.
    if (next === "dark") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("theme");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("theme", "light");
    }
  }

  const avatar = (
    <div className="relative shrink-0">
      <div className="w-7 h-7 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-xs font-bold">
        {initial}
      </div>
      {unreadCount > 0 && variant === "sidebar" && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#36D7B7] ring-2 ring-[#13151c]"
          aria-label={`${unreadCount} unread notifications`}
        />
      )}
    </div>
  );

  return (
    <div ref={rootRef} className={variant === "sidebar" ? "relative" : "relative shrink-0"}>
      {/* Trigger */}
      {variant === "sidebar" ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          className="w-full flex items-center gap-3 px-1 lg:px-3 py-2 rounded-lg hover:bg-white/5 transition"
        >
          {avatar}
          <span className="hidden lg:block text-sm text-gray-300 font-medium truncate">{username}</span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`hidden lg:block ml-auto text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label="Account and settings"
          className="rounded-full ring-2 ring-transparent hover:ring-white/20 transition"
        >
          {avatar}
        </button>
      )}

      {/* Popover */}
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute z-50 w-60 bg-[#1a1d23] border border-white/10 rounded-2xl shadow-xl p-1.5 ${
            variant === "sidebar"
              ? "bottom-full mb-2 left-0"
              : "top-full mt-2 right-0"
          }`}
        >
          {/* User header */}
          <div className="flex items-center gap-3 px-2.5 py-2">
            <div className="w-9 h-9 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-sm font-bold shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{username}</p>
              {email && <p className="text-gray-400 text-xs truncate">{email}</p>}
            </div>
          </div>

          <div className="my-1 border-t border-white/5" />

          {/* Appearance */}
          <div className="px-2.5 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Appearance</p>
            <div className="flex gap-1 bg-[#0f1117] rounded-lg p-0.5">
              {(["light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === t}
                  onClick={() => applyTheme(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold capitalize transition ${
                    theme === t ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {t === "light" ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="my-1 border-t border-white/5" />

          {/* Notifications feed */}
          <Link
            href="/notifications"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            Notifications
            {unreadCount > 0 && (
              <span className="ml-auto bg-[#4B3DFF] text-white text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {unreadCount}
              </span>
            )}
          </Link>

          <div className="my-1 border-t border-white/5" />

          {/* Sign out */}
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
