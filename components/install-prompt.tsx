"use client";

import { createContext, useContext, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallState = {
  canInstall: boolean; // native install available (Android / desktop Chrome/Edge)
  isIos: boolean;
  isStandalone: boolean; // already installed
  install: () => Promise<void>;
};

const InstallContext = createContext<InstallState>({
  canInstall: false,
  isIos: false,
  isStandalone: true,
  install: async () => {},
});

export const useInstall = () => useContext(InstallContext);

/**
 * Captures the (early-firing) beforeinstallprompt event once at the app root so
 * any nav item can offer "Install app" on demand.
 */
export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true); // assume installed until proven otherwise (no flash)

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(!!standalone);
    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
  };

  return (
    <InstallContext.Provider value={{ canInstall: !!deferred && !isStandalone, isIos, isStandalone, install }}>
      {children}
    </InstallContext.Provider>
  );
}

/** Always-visible "Install app" row for the desktop sidebar. Shown only when a
 *  native install is available (Chrome/Edge) and the app isn't installed yet —
 *  so iOS (which has no sidebar) and non-installable browsers see nothing. */
export function InstallSidebarItem() {
  const { canInstall, isStandalone, install } = useInstall();
  if (isStandalone || !canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => install()}
      className="mt-2 w-full px-1 lg:px-3 py-2 text-sm text-[#9b91ff] hover:text-white transition rounded-lg hover:bg-white/5 flex items-center gap-3"
      title="Install Disc Fantasy"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      <span className="hidden lg:block">Install app</span>
    </button>
  );
}

/** "Install app" entry for the profile menu (used on both desktop + mobile).
 *  Triggers the native install where available; on iOS it expands the
 *  Add-to-Home-Screen steps inline. Renders nothing when there's no install
 *  path (already installed, or a browser that can't install). */
export function InstallMenuItem() {
  const { canInstall, isIos, isStandalone, install } = useInstall();
  const [showIos, setShowIos] = useState(false);

  if (isStandalone) return null;
  if (!canInstall && !isIos) return null;

  return (
    <div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (canInstall) install();
          else setShowIos((s) => !s);
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 transition"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        Install app
      </button>
      {isIos && showIos && (
        <p className="px-2.5 pb-2 text-xs text-gray-400 leading-relaxed">
          Tap the Share icon
          <svg className="inline-block mx-1 -mt-0.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V3" />
            <path d="m8 7 4-4 4 4" />
            <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </svg>
          then <span className="text-gray-300 font-medium">Add to Home Screen</span>.
        </p>
      )}
    </div>
  );
}
