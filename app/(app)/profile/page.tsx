import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { EditProfileForm } from "@/components/edit-profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url, avatar_color")
    .eq("id", user.id)
    .single();

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <BackLink
          fallbackHref="/dashboard"
          label="Back"
          className="text-gray-400 hover:text-white text-sm transition inline-block mb-2"
        />
        <h2 className="text-white font-bold text-xl">Profile</h2>
        <p className="text-gray-400 text-sm mt-1">
          Choose how you show up across your leagues.
        </p>
      </div>

      <EditProfileForm
        initialUsername={profile?.username ?? "User"}
        initialColor={(profile as any)?.avatar_color ?? null}
        avatarUrl={(profile as any)?.avatar_url ?? null}
        email={user.email ?? null}
      />
    </div>
  );
}
