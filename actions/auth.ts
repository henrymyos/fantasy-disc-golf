"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { landingPathForUser } from "@/lib/landing";
import { z } from "zod";

/**
 * Rejects passwords found in the HaveIBeenPwned "Pwned Passwords" breach
 * corpus — the same protection as Supabase's Pro-only toggle, done for free in
 * app code. Uses k-anonymity: only the first 5 chars of the SHA-1 are sent, so
 * the password never leaves the server in full. Fails open (returns false) if
 * the service is unreachable, so a third-party outage can't lock people out.
 */
async function isPasswordCompromised(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body
      .split("\n")
      .some((line) => line.split(":")[0]?.trim() === suffix);
  } catch {
    return false;
  }
}

/** Returns a safe in-app redirect target from a `next` form field, or
 *  /dashboard. Only same-site absolute paths are allowed (no protocol-relative
 *  "//evil.com" or external URLs), so the param can't be used for open redirects. */
function safeNext(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v;
  return "/dashboard";
}

/** Absolute origin of the current request, for building auth redirect URLs. */
async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const SignupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(20).trim(),
  email: z.string().email("Invalid email address").trim(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const LoginSchema = z.object({
  email: z.string().email("Invalid email address").trim(),
  password: z.string().min(1, "Password is required"),
});

export type AuthState = {
  errors?: Record<string, string[]>;
  message?: string;
  /** When true, `message` is an informational/success note rather than an error. */
  success?: boolean;
} | null;

const ResetRequestSchema = z.object({
  email: z.string().email("Invalid email address").trim(),
});

const NewPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Sends a password-reset email. Always reports success so we don't reveal
 *  which addresses have accounts. */
export async function requestPasswordReset(_state: AuthState, formData: FormData): Promise<AuthState> {
  const result = ResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const origin = await siteOrigin();
  await supabase.auth.resetPasswordForEmail(result.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  return {
    success: true,
    message: "If an account exists for that email, a password-reset link is on its way.",
  };
}

/** Sets a new password for the user currently authenticated via a recovery
 *  session (established by the reset link). */
export async function updatePassword(_state: AuthState, formData: FormData): Promise<AuthState> {
  const result = NewPasswordSchema.safeParse({ password: formData.get("password") });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  if (await isPasswordCompromised(result.data.password)) {
    return { errors: { password: ["This password has appeared in a data breach. Please choose a different one."] } };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { message: "Your reset link has expired or is invalid. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: result.data.password });
  if (error) {
    return { message: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(_state: AuthState, formData: FormData): Promise<AuthState> {
  const result = SignupSchema.safeParse({
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { username, email, password } = result.data;

  if (await isPasswordCompromised(password)) {
    return { errors: { password: ["This password has appeared in a data breach. Please choose a different one."] } };
  }

  const supabase = await createClient();
  const nextPath = safeNext(formData.get("next"));
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      // If email confirmation is enabled, the confirmation link must carry the
      // invite `next` through the callback, otherwise a brand-new invitee loses
      // their destination and falls back to /dashboard instead of the join form.
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    },
  });

  if (error) {
    return { message: error.message };
  }

  // Create the profile row the rest of the app depends on (leagues, members,
  // etc. all reference profiles.id). The DB trigger is a no-op, so this is the
  // single place a profile gets created. Use the admin client because with
  // email confirmation enabled there is no authenticated session yet, so RLS
  // would block a self-insert.
  if (data.user) {
    const admin = createAdminClient();
    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: data.user.id, username }, { onConflict: "id" });
    if (profileError) {
      // The id conflict is handled by onConflict, so a unique violation here is
      // the username constraint: the name is already taken by another account.
      // Surface a friendly, field-level message rather than the raw DB error.
      // We deliberately do not delete the just-created auth user.
      if (profileError.code === "23505") {
        return { errors: { username: ["That username is taken. Please choose another."] } };
      }
      return { message: profileError.message };
    }
  }

  revalidatePath("/", "layout");

  // With email confirmation enabled, signUp returns no session — the user must
  // confirm by email before they can sign in, so redirecting into the app would
  // just bounce off the proxy. Only redirect when a real session exists (the
  // current happy path when confirmation is disabled); otherwise tell them to
  // check their email. The invite `next` is preserved via emailRedirectTo above.
  if (data.session) {
    redirect(nextPath);
  }

  return {
    success: true,
    message: "Account created. Check your email to confirm your address, then sign in.",
  };
}

export async function login(_state: AuthState, formData: FormData): Promise<AuthState> {
  const result = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { email, password } = result.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { message: "Invalid email or password" };
  }

  // Self-heal a missing profile. This app shares one auth pool with sibling
  // apps, so a user can authenticate here without ever having a profile row in
  // this app's tables (profiles are created in the signup action, not a DB
  // trigger). Mirror that creation on login so downstream FKs always resolve.
  // `ignoreDuplicates` means an existing profile (and its chosen username) is
  // left untouched, and we never block login on this best-effort backfill.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const admin = createAdminClient();
    const metaUsername = (user.user_metadata as { username?: unknown } | null)?.username;
    const username =
      (typeof metaUsername === "string" && metaUsername.trim()) ||
      user.email?.split("@")[0] ||
      `user_${user.id.slice(0, 8)}`;
    await admin
      .from("profiles")
      .upsert({ id: user.id, username }, { onConflict: "id", ignoreDuplicates: true });
  }

  revalidatePath("/", "layout");
  // Honor an explicit destination (e.g. following an invite link); otherwise
  // land on the league the user was most recently in.
  const nextRaw = formData.get("next");
  const hasExplicitNext =
    typeof nextRaw === "string" &&
    nextRaw.startsWith("/") &&
    !nextRaw.startsWith("//") &&
    !nextRaw.startsWith("/\\");
  if (hasExplicitNext) redirect(nextRaw);
  redirect(user ? await landingPathForUser(user.id) : "/dashboard");
}

export async function logout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
