"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const CreateLeagueSchema = z.object({
  name: z.string().min(3, "League name must be at least 3 characters").max(50).trim(),
  teamName: z.string().min(1, "Team name is required").max(30).trim(),
  maxTeams: z.coerce.number().int().min(2).max(20).default(12),
  rosterSize: z.coerce.number().int().min(5).max(20).default(10),
  startersCount: z.coerce.number().int().min(1).max(10).default(6),
});

const JoinLeagueSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required").trim().toUpperCase(),
  teamName: z.string().min(1, "Team name is required").max(30).trim(),
});

export type LeagueActionState = {
  errors?: Record<string, string[]>;
  message?: string;
} | null;

export async function createLeague(
  _state: LeagueActionState,
  formData: FormData
): Promise<LeagueActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = CreateLeagueSchema.safeParse({
    name: formData.get("name"),
    teamName: formData.get("teamName"),
    maxTeams: formData.get("maxTeams") || 12,
    rosterSize: formData.get("rosterSize") || 10,
    startersCount: formData.get("startersCount") || 5,
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { name, teamName, maxTeams, rosterSize, startersCount } = result.data;
  const admin = createAdminClient();

  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name,
      commissioner_id: user.id,
      invite_code: generateInviteCode(),
      max_teams: maxTeams,
      roster_size: rosterSize,
      starters_count: startersCount,
    })
    .select()
    .single();

  if (leagueError) return { message: leagueError.message };

  const { error: memberError } = await admin.from("league_members").insert({
    league_id: league.id,
    user_id: user.id,
    team_name: teamName,
    is_commissioner: true,
  });

  if (memberError) return { message: memberError.message };

  await admin.from("drafts").insert({
    league_id: league.id,
    total_rounds: rosterSize,
  });

  revalidatePath("/dashboard");
  redirect(`/league/${league.id}`);
}

export async function joinLeague(
  _state: LeagueActionState,
  formData: FormData
): Promise<LeagueActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = JoinLeagueSchema.safeParse({
    inviteCode: formData.get("inviteCode"),
    teamName: formData.get("teamName"),
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { inviteCode, teamName } = result.data;
  const admin = createAdminClient();

  const { data: league, error: findError } = await admin
    .from("leagues")
    .select("*")
    .eq("invite_code", inviteCode)
    .single();

  if (findError || !league) {
    return { message: "League not found. Check your invite code." };
  }

  const { count } = await admin
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", league.id);

  if ((count ?? 0) >= league.max_teams) {
    return { message: "This league is full." };
  }

  const { data: existing } = await admin
    .from("league_members")
    .select("id")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .single();

  if (existing) redirect(`/league/${league.id}`);

  const { error: joinError } = await admin.from("league_members").insert({
    league_id: league.id,
    user_id: user.id,
    team_name: teamName,
    is_commissioner: false,
  });

  if (joinError) return { message: joinError.message };

  revalidatePath("/dashboard");
  redirect(`/league/${league.id}`);
}

export async function deleteLeague(leagueId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.commissioner_id !== user.id) {
    throw new Error("Not authorized");
  }

  await admin.from("leagues").delete().eq("id", leagueId);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
