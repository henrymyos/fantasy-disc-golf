import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/actions/auth";
import { SidebarNav } from "@/components/sidebar-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  return (
    <div className="min-h-screen bg-[#0f1117] flex">
      {/* Sidebar */}
      <aside className="w-56 bg-[#13151c] border-r border-white/5 flex flex-col py-6 px-4 fixed h-full">
        <Link href="/dashboard" className="mb-8 block">
          <h1 className="text-xl font-black text-white tracking-tight">
            <span className="text-[#4B3DFF]">Disc</span> Fantasy
          </h1>
        </Link>

        <SidebarNav />

        <div className="border-t border-white/5 pt-4 mt-4">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#4B3DFF] flex items-center justify-center text-white text-xs font-bold">
              {profile?.username?.[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="text-sm text-gray-300 font-medium truncate">
              {profile?.username ?? "User"}
            </span>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition rounded-lg hover:bg-white/5"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-56 p-6 min-h-screen">
        {children}
      </main>
    </div>
  );
}
