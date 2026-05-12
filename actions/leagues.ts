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
  mpoStarters: z.coerce.number().int().min(1).max(10).default(4),
  fpoStarters: z.coerce.number().int().min(1).max(10).default(2),
}).refine((d) => d.mpoStarters + d.fpoStarters <= d.rosterSize, {
  message: "Total starters cannot exceed roster size",
  path: ["fpoStarters"],
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
    mpoStarters: formData.get("mpoStarters") || 4,
    fpoStarters: formData.get("fpoStarters") || 2,
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { name, teamName, maxTeams, rosterSize, mpoStarters, fpoStarters } = result.data;
  const startersCount = mpoStarters + fpoStarters;
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
      mpo_starters: mpoStarters,
      fpo_starters: fpoStarters,
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

const UpdateLeagueSchema = z.object({
  name: z.string().min(3).max(50).trim(),
  maxTeams: z.coerce.number().int().min(2).max(20),
  rosterSize: z.coerce.number().int().min(5).max(20),
  mpoStarters: z.coerce.number().int().min(1).max(20),
  fpoStarters: z.coerce.number().int().min(1).max(20),
}).refine((d) => d.mpoStarters + d.fpoStarters <= d.rosterSize, {
  message: "Total starters cannot exceed roster size",
  path: ["fpoStarters"],
});

export async function updateLeague(
  leagueId: string,
  _state: LeagueActionState,
  formData: FormData
): Promise<LeagueActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = UpdateLeagueSchema.safeParse({
    name: formData.get("name"),
    maxTeams: formData.get("maxTeams"),
    rosterSize: formData.get("rosterSize"),
    mpoStarters: formData.get("mpoStarters"),
    fpoStarters: formData.get("fpoStarters"),
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { name, maxTeams, rosterSize, mpoStarters, fpoStarters } = result.data;
  const startersCount = mpoStarters + fpoStarters;
  const admin = createAdminClient();

  const { data: league } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.commissioner_id !== user.id) {
    return { message: "Not authorized" };
  }

  const { error } = await admin
    .from("leagues")
    .update({ name, max_teams: maxTeams, roster_size: rosterSize, starters_count: startersCount, mpo_starters: mpoStarters, fpo_starters: fpoStarters })
    .eq("id", leagueId);

  if (error) return { message: error.message };

  revalidatePath(`/league/${leagueId}`);
  return { message: "saved" };
}

export async function setSelectedEvents(
  leagueId: string,
  slugs: string[]
): Promise<void> {
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

  const cleaned = Array.from(new Set(slugs.filter((s) => typeof s === "string" && s.length > 0)));

  const { error } = await admin
    .from("leagues")
    .update({ selected_event_slugs: cleaned })
    .eq("id", leagueId);

  if (error) throw new Error(error.message);

  revalidatePath(`/league/${leagueId}/settings`);
  revalidatePath(`/league/${leagueId}/settings/season`);
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
