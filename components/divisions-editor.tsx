"use client";

import { useState, useTransition } from "react";
import { setMemberDivision } from "@/actions/matchups";

type Member = { id: number; team_name: string; division_name: string | null };

export function DivisionsEditor({
  leagueId,
  initialMembers,
}: {
  leagueId: number;
  initialMembers: Member[];
}) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [pending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<number | null>(null);

  function commit(memberId: number, value: string) {
    const cleaned = value.trim();
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, division_name: cleaned || null } : m)));
    setSavingId(memberId);
    startTransition(async () => {
      try {
        await setMemberDivision(leagueId, memberId, cleaned || null);
      } finally {
        setSavingId(null);
      }
    });
  }

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.id} className="flex items-center gap-3">
          <span className="text-white text-sm flex-1 truncate">{m.team_name}</span>
          <input
            defaultValue={m.division_name ?? ""}
            placeholder="No division"
            onBlur={(e) => {
              const v = e.target.value;
              if ((v.trim() || null) !== (m.division_name ?? null)) commit(m.id, v);
            }}
            disabled={pending && savingId === m.id}
            className="bg-[#0f1117] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm w-32 focus:outline-none focus:border-[#4B3DFF] disabled:opacity-50"
          />
        </div>
      ))}
      <p className="text-gray-600 text-xs">
        Teams with the same division name play each other more often. Leave blank for no division.
      </p>
    </div>
  );
}
