import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingPathForUser } from "@/lib/landing";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(await landingPathForUser(user.id));
  } else {
    redirect("/login");
  }
}
