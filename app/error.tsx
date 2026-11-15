"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

// Replaces Next's bare "Application error" screen when a page throws (e.g. a
// Supabase call fails). retry() re-fetches and re-renders the failed segment.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center bg-[#1a1d23] rounded-2xl p-8 shadow-2xl border border-white/5">
        <p className="text-2xl font-black text-white tracking-tight">
          <span className="text-[#6A5DFF]">Disc</span> Fantasy
        </p>
        <h1 className="text-xl font-bold text-white mt-6 mb-2">Something went wrong</h1>
        <p className="text-gray-400 text-sm">This page didn&apos;t load. Try again in a moment.</p>
        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => retry()}
            className="rounded-lg bg-[#4B3DFF] hover:bg-[#3d30e0] text-white text-sm font-semibold px-4 py-2.5"
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-white/10 text-gray-200 hover:bg-white/5 text-sm font-semibold px-4 py-2.5">
            Home
          </Link>
        </div>
        {digest && <p className="text-gray-500 text-xs mt-6">Error ID: {digest}</p>}
      </div>
    </main>
  );
}
