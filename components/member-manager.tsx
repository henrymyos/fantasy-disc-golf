"use client";

import { useState, useTransition } from "react";
import { removeMember, transferCommissioner, leaveLeague } from "@/actions/members";

type Member = {
  id: number;
  teamName: string;
  isCommissioner: boolean;
  isMe: boolean;
};

export function MemberManager({
  leagueId,
  myMemberId,
  isCommissioner,
  draftLocked,
  members,
}: {
  leagueId: number;
  myMemberId: number;
  isCommissioner: boolean;
  draftLocked: boolean;
  members: Member[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function run(id: number, fn: () => Promise<{ error?: string }>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 divide-y divide-white/5 overflow-hidden">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-[#4B3DFF]/20 text-[#9b91ff] flex items-center justify-center font-bold text-sm shrink-0">
              {m.teamName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-medium text-sm truncate">{m.teamName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {m.isCommissioner && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[#36D7B7] bg-[#36D7B7]/10">
                    Commissioner
                  </span>
                )}
                {m.isMe && <span className="text-gray-400 text-xs">You</span>}
              </div>
            </div>

            {/* Commissioner controls on other members */}
            {isCommissioner && !m.isMe && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Make ${m.teamName} the commissioner? You'll lose commissioner controls.`)) {
                      run(m.id, () => transferCommissioner(leagueId, m.id));
                    }
                  }}
                  className="text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-full transition disabled:opacity-50"
                >
                  {busyId === m.id && pending ? "…" : "Make commish"}
                </button>
                {!draftLocked && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.teamName} from the league? This can't be undone.`)) {
                        run(m.id, () => removeMember(leagueId, m.id));
                      }
                    }}
                    className="text-xs text-red-400/80 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-3 py-1.5 rounded-full transition disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {/* Self leave (non-commissioner) */}
            {m.isMe && !m.isCommissioner && !draftLocked && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Leave this league? You'll need a new invite to rejoin.")) {
                    run(myMemberId, () => leaveLeague(leagueId));
                  }
                }}
                className="text-xs text-red-400/80 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-3 py-1.5 rounded-full transition disabled:opacity-50 shrink-0"
              >
                Leave
              </button>
            )}
          </div>
        ))}
      </div>

      {draftLocked && (
        <p className="text-gray-500 text-xs">
          Removing or leaving is disabled once the draft has started, to avoid breaking the schedule.
        </p>
      )}
    </div>
  );
}
