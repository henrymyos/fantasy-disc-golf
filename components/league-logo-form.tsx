"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadLeagueLogo, removeLeagueLogo } from "@/actions/leagues";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function LeagueLogoForm({
  leagueId,
  leagueName,
  logoUrl,
}: {
  leagueId: string;
  leagueName: string;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const initial = leagueName?.trim()?.[0]?.toUpperCase() ?? "?";

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    // Validate up front so an oversized file fails gracefully here instead of
    // being rejected mid-request.
    if (!ALLOWED.includes(file.type)) {
      setError("Use a PNG, JPG, WEBP, or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5 MB. Try a smaller photo.");
      return;
    }
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await uploadLeagueLogo(leagueId, fd);
        if (res?.error) setError(res.error);
        else router.refresh();
      } catch {
        setError("Upload failed. Please try a smaller image.");
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      try {
        const res = await removeLeagueLogo(leagueId);
        if (res?.error) setError(res.error);
        else router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        League photo
      </p>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="League logo"
            className="w-20 h-20 rounded-2xl object-cover shrink-0 bg-white/10"
          />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-[#4B3DFF]/20 border border-[#4B3DFF]/30 flex items-center justify-center text-[#4B3DFF] font-black text-3xl shrink-0">
            {initial}
          </div>
        )}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-xs font-semibold bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
            >
              {busy ? "Uploading…" : logoUrl ? "Change photo" : "Upload photo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="text-xs font-semibold border border-white/10 hover:border-white/30 text-gray-300 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-gray-500 text-[11px]">PNG, JPG, WEBP, or GIF · up to 5 MB</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onPickFile}
          className="hidden"
        />
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
