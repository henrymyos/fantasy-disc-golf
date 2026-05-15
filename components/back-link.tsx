"use client";

import { useRouter } from "next/navigation";

export function BackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
    >
      ← Back
    </a>
  );
}
