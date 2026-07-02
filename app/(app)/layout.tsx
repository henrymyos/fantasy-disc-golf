import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/actions/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ProfileMenu } from "@/components/profile-menu";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { InstallProvider, InstallSidebarItem } from "@/components/install-prompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url, avatar_color")
    .eq("id", user.id)
    .single();

  const username = profile?.username ?? "User";
  const avatarUrl = (profile as any)?.avatar_url ?? null;
  const avatarColor = (profile as any)?.avatar_color ?? null;

  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  // Leagues for the sidebar "My Leagues" subsection (most recently joined first).
  const { data: leagueMemberships } = await supabase
    .from("league_members")
    .select("league_id, leagues(id, name, logo_url)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });
  const sidebarLeagues = (leagueMemberships ?? [])
    .map((m: any) => ({
      id: m.leagues?.id as number,
      name: (m.leagues?.name as string) ?? "League",
      logoUrl: (m.leagues?.logo_url as string | null) ?? null,
    }))
    .filter((l) => l.id != null);

  return (
    <InstallProvider>
    <div className="min-h-screen bg-[#0f1117]">
      <ServiceWorkerRegister />
      {/* Mobile top bar (hidden md+) */}
      <MobileTopBar username={username} email={user.email ?? null} unreadCount={unreadCount ?? 0} logoutAction={logout} avatarUrl={avatarUrl} avatarColor={avatarColor} />

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

        <SidebarNav leagues={sidebarLeagues} />

        <InstallSidebarItem />

        <div className="border-t border-white/5 pt-4 mt-4">
          <ProfileMenu
            username={username}
            email={user.email ?? null}
            logoutAction={logout}
            variant="sidebar"
            unreadCount={unreadCount ?? 0}
            avatarUrl={avatarUrl}
            avatarColor={avatarColor}
          />
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-14 lg:ml-56 p-4 lg:p-6 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-6 min-h-screen">
        {children}
      </main>

      <MobileBottomNav />
    </div>
    </InstallProvider>
  );
}
