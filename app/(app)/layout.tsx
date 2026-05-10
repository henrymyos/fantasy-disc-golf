import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/actions/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const username = profile?.username ?? "User";

  return (
    <div className="min-h-screen bg-[#0f1117]">
      {/* Mobile top bar (hidden md+) */}
      <MobileTopBar username={username} logoutAction={logout} />

      {/* Sidebar (hidden below md) */}
      <aside className="hidden md:flex md:w-14 lg:w-56 bg-[#13151c] border-r border-white/5 flex-col py-6 px-2 lg:px-4 fixed top-0 h-full z-20">
        <Link href="/dashboard" className="mb-8 block">
          <h1 className="hidden lg:block text-xl font-black text-white tracking-tight">
            <span className="text-[#4B3DFF]">Disc</span> Fantasy
          </h1>
          <div className="lg:hidden w-8 h-8 bg-[#4B3DFF] rounded-lg flex items-center justify-center text-white font-black text-sm">
            D
          </div>
        </Link>

        <SidebarNav />

        <div className="border-t border-white/5 pt-4 mt-4">
          <div className="flex items-center gap-3 px-1 lg:px-3 py-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {username[0]?.toUpperCase()}
            </div>
            <span className="hidden lg:block text-sm text-gray-300 font-medium truncate">
              {username}
            </span>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-1 lg:px-3 py-2 text-sm text-red-400/70 hover:text-red-400 transition rounded-lg hover:bg-red-500/10 flex items-center gap-3"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span className="hidden lg:block">Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-14 lg:ml-56 p-4 lg:p-6 min-h-screen">
        {children}
      </main>
    </div>
  );
}
