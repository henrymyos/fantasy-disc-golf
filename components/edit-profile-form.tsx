"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, uploadAvatar, removeAvatar } from "@/actions/profile";

const COLORS = [
  "#4B3DFF",
  "#36D7B7",
  "#F5A524",
  "#f87171",
  "#a78bfa",
  "#ec4899",
  "#22c55e",
  "#0ea5e9",
  "#fb923c",
  "#64748b",
];

export function EditProfileForm({
  initialUsername,
  initialColor,
  avatarUrl,
  email,
}: {
  initialUsername: string;
  initialColor: string | null;
  avatarUrl: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [color, setColor] = useState(initialColor ?? COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const [busyPhoto, startPhoto] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const initial = username?.trim()?.[0]?.toUpperCase() ?? "?";

  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  function save() {
    setError(null);
    setSaved(false);
    startSave(async () => {
      try {
        const fd = new FormData();
        fd.set("username", username);
        fd.set("avatarColor", color);
        const res = await updateProfile(fd);
        if (res?.error) setError(res.error);
        else {
          setSaved(true);
          router.refresh();
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSaved(false);
    // Validate before uploading so an oversized file fails gracefully here
    // instead of being rejected mid-request.
    if (!ALLOWED.includes(file.type)) {
      setError("Use a PNG, JPG, WEBP, or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5 MB. Try a smaller photo.");
      return;
    }
    startPhoto(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await uploadAvatar(fd);
        if (res?.error) setError(res.error);
        else router.refresh();
      } catch {
        setError("Upload failed. Please try a smaller image.");
      }
    });
  }

  function removePhoto() {
    setError(null);
    startPhoto(async () => {
      try {
        await removeAvatar();
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-5">
        {/* Avatar preview + photo controls */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Your avatar"
              className="w-20 h-20 rounded-full object-cover shrink-0 bg-white/10"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
              style={{ backgroundColor: color }}
            >
              {initial}
            </div>
          )}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busyPhoto}
                className="text-xs font-semibold bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                {busyPhoto ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={busyPhoto}
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

        {/* Color picker — applies when there's no photo */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
            Icon color
          </p>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Use ${c}`}
                aria-pressed={color === c}
                className={`w-8 h-8 rounded-full transition ${
                  color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#1a1d23]" : "hover:scale-110"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {avatarUrl && (
            <p className="text-gray-500 text-[11px] mt-2">Remove your photo to show the colored icon.</p>
          )}
        </div>

        {/* Display name */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">
            Display name
          </label>
          <input
            type="text"
            value={username}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#4B3DFF]"
          />
          {email && <p className="text-gray-500 text-[11px] mt-1.5">Signed in as {email}</p>}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || username.trim().length < 3}
            className="bg-[#4B3DFF] hover:bg-[#3a2eff] disabled:bg-white/10 disabled:text-gray-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && !saving && <span className="text-[#36D7B7] text-sm">Saved</span>}
        </div>
      </div>
    </div>
  );
}
