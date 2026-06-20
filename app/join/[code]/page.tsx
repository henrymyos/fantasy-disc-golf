import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Public invite landing. Anyone (logged in or not) can open it. Logged-in users
 * go straight to the prefilled in-app join form; everyone else gets a friendly
 * sign-up / sign-in screen that carries the invite code through auth so they
 * land back on the join form afterward.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode).trim().toUpperCase();
  const joinPath = `/league/join?code=${encodeURIComponent(code)}`;

  // Already signed in → straight to the prefilled join form.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(joinPath);

  // Look up the league name to personalize the invite (service role: the
  // visitor isn't authenticated yet, so RLS would hide it).
  const admin = createAdminClient();
  const { data: league } = await admin
    .from("leagues")
    .select("name")
    .eq("invite_code", code)
    .maybeSingle();

  const leagueName = (league as any)?.name as string | undefined;

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">
            <span className="text-[#4B3DFF]">Disc</span> Fantasy
          </h1>
          <p className="text-gray-400 text-sm mt-1">Fantasy Disc Golf League Platform</p>
        </div>

        <div className="bg-[#1a1d23] rounded-2xl p-8 shadow-2xl border border-white/5 text-center">
          {leagueName ? (
            <>
              <p className="text-gray-400 text-sm">You&apos;re invited to join</p>
              <h2 className="text-2xl font-bold text-white mt-1 mb-1">{leagueName}</h2>
            </>
          ) : (
            <h2 className="text-2xl font-bold text-white mb-1">Join a league</h2>
          )}
          <p className="text-gray-400 text-sm mb-1">Invite code</p>
          <p className="font-mono text-white font-bold text-lg tracking-widest mb-6">{code}</p>

          <div className="space-y-2.5">
            <Link
              href={`/signup?next=${encodeURIComponent(joinPath)}`}
              className="block w-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold py-2.5 rounded-lg transition"
            >
              Create an account to join
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(joinPath)}`}
              className="block w-full border border-white/10 hover:border-white/30 text-gray-200 font-semibold py-2.5 rounded-lg transition"
            >
              I already have an account
            </Link>
          </div>

          <p className="text-gray-500 text-xs mt-5">
            After signing in, your invite code will be filled in automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
