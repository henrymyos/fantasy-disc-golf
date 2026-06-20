"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export type ProfileActionState = { error?: string; ok?: boolean } | null;

const ProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Name must be at least 3 characters")
    .max(20, "Name must be 20 characters or fewer")
    .trim(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Invalid color")
    .nullable(),
});

/** Update display name + avatar color. */
export async function updateProfile(formData: FormData): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawColor = formData.get("avatarColor");
  const result = ProfileSchema.safeParse({
    username: formData.get("username"),
    avatarColor: rawColor === "" || rawColor == null ? null : rawColor,
  });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid input" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ username: result.data.username, avatar_color: result.data.avatarColor })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "That name is already taken." };
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Upload a new avatar photo and point the profile at its public URL. */
export async function uploadAvatar(formData: FormData): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > MAX_BYTES) return { error: "Image must be under 5 MB." };
  if (!ALLOWED.has(file.type)) return { error: "Use a PNG, JPG, WEBP, or GIF image." };

  const admin = createAdminClient();
  // A per-user folder keeps uploads tidy; the timestamp busts the CDN cache so
  // the new photo shows immediately instead of a stale cached one.
  const path = `${user.id}/${Date.now()}.${EXT[file.type]}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);

  const { error } = await admin
    .from("profiles")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Clear the avatar photo, reverting to the colored initial. */
export async function removeAvatar(): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
