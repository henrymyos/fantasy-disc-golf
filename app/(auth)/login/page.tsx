"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthState } from "@/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, null);

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-8 shadow-2xl border border-white/5">
      <h2 className="text-xl font-bold text-white mb-6">Sign In</h2>

      <form action={action} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1" htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition"
            placeholder="you@example.com"
          />
          {state?.errors?.email && (
            <p className="text-red-400 text-xs mt-1">{state.errors.email[0]}</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1" htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] transition"
            placeholder="••••••••"
          />
          {state?.errors?.password && (
            <p className="text-red-400 text-xs mt-1">{state.errors.password[0]}</p>
          )}
        </div>

        {state?.message && (
          <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <p className="text-center text-gray-500 text-sm mt-6">
        No account?{" "}
        <Link href="/signup" className="text-[#36D7B7] hover:text-[#4B3DFF] transition">
          Create one
        </Link>
      </p>
    </div>
  );
}
