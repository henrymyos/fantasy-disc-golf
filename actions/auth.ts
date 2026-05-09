"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

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
} | null;

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
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    return { message: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
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

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function logout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
