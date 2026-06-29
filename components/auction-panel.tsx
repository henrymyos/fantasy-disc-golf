"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { nominatePlayer, placeBid, finalizeAuctionPick } from "@/actions/auction";

type Member = {
  id: number;
  user_id: string | null;
  team_name: string;
  draft_position: number | null;
  auction_budget_remaining: number | null;
};
type DraftState = {
  id: number;
  status: string;
  type: string;
  current_pick: number;
  total_rounds: number;
  seconds_per_pick: number;
  auction_budget: number;
  auction_current_player_id: number | null;
  auction_current_bid: number | null;
  auction_high_bidder_team_id: number | null;
  auction_nominator_team_id: number | null;
  auction_ends_at: string | null;
};
type Player = {
  id: number;
  name: string;
  division: string;
  overall_rank: number | null;
};

export function AuctionPanel({
  leagueId,
  myUserId,
}: {
  leagueId: number;
  myUserId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [draftedIds, setDraftedIds] = useState<Set<number>>(new Set());
  const [ownedByTeam, setOwnedByTeam] = useState<Map<number, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [openingBid, setOpeningBid] = useState(1);
  const [bidAmount, setBidAmount] = useState(0);
  const [nomineeId, setNomineeId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const firedFinalizeFor = useRef<number | null>(null);

  // Initial load + 2s poll (the page also re-runs server components, so this
  // is a fast inner refresh of just the auction state).
  async function refresh() {
    const supabase = createClient();
    const { data: d } = await supabase
      .from("drafts")
      .select("id, status, type, current_pick, total_rounds, seconds_per_pick, auction_budget, auction_current_player_id, auction_current_bid, auction_high_bidder_team_id, auction_nominator_team_id, auction_ends_at")
      .eq("league_id", leagueId)
      .single();
    const { data: m } = await supabase
      .from("league_members")
      .select("id, user_id, team_name, draft_position, auction_budget_remaining")
      .eq("league_id", leagueId)
      .order("draft_position");
    const { data: rostered } = await supabase
      .from("rosters")
      .select("player_id, team_id")
      .eq("league_id", leagueId);
    setDraft(d as any);
    setMembers((m ?? []) as any);
    setDraftedIds(new Set((rostered ?? []).map((r: any) => r.player_id)));
    const owned = new Map<number, number>();
    for (const r of rostered ?? []) owned.set((r as any).team_id, (owned.get((r as any).team_id) ?? 0) + 1);
    setOwnedByTeam(owned);
  }

  useEffect(() => {
    refresh();
    const supabase = createClient();
    supabase
      .from("players")
      .select("id, name, division, overall_rank")
      .order("overall_rank", { ascending: true, nullsFirst: false })
      .limit(500)
      .then(({ data }) => setPlayers((data ?? []) as any));
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [leagueId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const me = useMemo(
    () => members.find((m) => m.user_id === myUserId) ?? null,
    [members, myUserId],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const nominator = draft?.auction_nominator_team_id != null
    ? memberById.get(draft.auction_nominator_team_id) ?? null
    : null;
  const highBidder = draft?.auction_high_bidder_team_id != null
    ? memberById.get(draft.auction_high_bidder_team_id) ?? null
    : null;
  const nominatedPlayer = draft?.auction_current_player_id != null
    ? players.find((p) => p.id === draft.auction_current_player_id) ?? null
    : null;
  const isMyNomination = me != null && nominator != null && me.id === nominator.id;
  const endsMs = draft?.auction_ends_at ? Date.parse(draft.auction_ends_at) : null;
  const secondsLeft = endsMs ? Math.max(0, Math.ceil((endsMs - now) / 1000)) : null;
  const isBidding = draft?.auction_current_player_id != null;

  // Auto-finalize when timer hits 0 (once per pick).
  useEffect(() => {
    if (!isBidding || secondsLeft == null) return;
    if (secondsLeft > 0) return;
    if (draft && firedFinalizeFor.current !== draft.current_pick) {
      firedFinalizeFor.current = draft.current_pick;
      finalizeAuctionPick(leagueId).then(() => {
        refresh();
        router.refresh();
      });
    }
  }, [isBidding, secondsLeft, draft?.current_pick, leagueId]);

  // Reset firedFinalizeFor when a new auction starts.
  useEffect(() => {
    if (isBidding) firedFinalizeFor.current = null;
  }, [isBidding, draft?.current_pick]);

  const availablePlayers = useMemo(
    () =>
      players
        .filter((p) => !draftedIds.has(p.id))
        .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 100),
    [players, draftedIds, search],
  );

  function submitNomination() {
    if (nomineeId == null) return;
    startTransition(async () => {
      await nominatePlayer(leagueId, nomineeId, openingBid);
      setNomineeId(null);
      setOpeningBid(1);
      refresh();
      router.refresh();
    });
  }

  function submitBid() {
    // The input shows `bidAmount || myMinBid`, so an unedited click leaves
    // bidAmount at 0 — resolve the effective amount the same way so clicking the
    // prefilled minimum bid actually submits instead of silently no-opping.
    const amount = bidAmount || myMinBid;
    if (amount <= (draft?.auction_current_bid ?? 0)) return;
    startTransition(async () => {
      await placeBid(leagueId, amount);
      refresh();
      router.refresh();
    });
  }

  if (!draft || draft.type !== "auction" || draft.status !== "in_progress") return null;

  // Mirror the server's maxBidFor: $1 must stay in reserve for each future
  // roster spot beyond the one being bid on, so the client cap matches what the
  // server will accept (otherwise valid-looking bids get silently rejected).
  const myOwned = me ? (ownedByTeam.get(me.id) ?? 0) : 0;
  const myRemainingSpots = Math.max(0, draft.total_rounds - myOwned);
  const myMaxBid = Math.max(0, (me?.auction_budget_remaining ?? 0) - Math.max(0, myRemainingSpots - 1));
  const myMinBid = (draft.auction_current_bid ?? 0) + 1;

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-5">
      {/* Team budgets */}
      <div>
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Budgets</p>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <div
              key={m.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                m.id === nominator?.id
                  ? "bg-[#36D7B7]/15 border-[#36D7B7]/40 text-[#36D7B7]"
                  : "bg-[#0f1117] border-white/5 text-gray-300"
              }`}
            >
              <span className="font-semibold">{m.team_name}</span>
              <span className="font-mono">${m.auction_budget_remaining ?? draft.auction_budget}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active nomination */}
      {isBidding && nominatedPlayer ? (
        <div className="bg-[#0f1117] rounded-xl p-5 border border-[#4B3DFF]/30">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">
                Nominated by {nominator?.team_name ?? "—"}
              </p>
              <p className="text-white font-bold text-xl">{nominatedPlayer.name}</p>
              <p className="text-gray-400 text-xs mt-0.5">{nominatedPlayer.division}</p>
            </div>
            <div className="text-right">
              <p className="text-[#36D7B7] font-mono text-3xl font-black">
                ${draft.auction_current_bid}
              </p>
              <p className="text-gray-400 text-xs mt-0.5">
                {highBidder?.team_name ?? "—"} · {secondsLeft ?? 0}s left
              </p>
            </div>
          </div>

          {me && me.id !== draft.auction_high_bidder_team_id && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={myMinBid}
                max={myMaxBid}
                step={1}
                value={bidAmount || myMinBid}
                onChange={(e) => setBidAmount(Number(e.target.value))}
                className="bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-28"
              />
              <button
                type="button"
                onClick={submitBid}
                disabled={pending || (bidAmount || myMinBid) > myMaxBid || (bidAmount || myMinBid) < myMinBid}
                className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40"
              >
                {pending ? "Bidding..." : `Bid $${bidAmount || myMinBid}`}
              </button>
              <p className="text-gray-400 text-xs">
                You have ${myMaxBid} max
              </p>
            </div>
          )}
          {me?.id === draft.auction_high_bidder_team_id && (
            <p className="text-[#36D7B7] text-sm font-semibold">You're the high bidder.</p>
          )}
        </div>
      ) : isMyNomination ? (
        /* Nomination form */
        <div className="bg-[#0f1117] rounded-xl p-5 border border-[#36D7B7]/30 space-y-3">
          <p className="text-[#36D7B7] font-semibold text-sm">Your turn to nominate</p>
          <input
            type="text"
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {availablePlayers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setNomineeId(p.id)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left text-sm transition ${
                  nomineeId === p.id
                    ? "bg-[#36D7B7]/15 border border-[#36D7B7]/40 text-white"
                    : "bg-[#1a1d23] border border-white/5 hover:border-white/15 text-gray-300"
                }`}
              >
                <span className="text-gray-400 text-xs font-mono w-8 text-right">
                  {p.overall_rank != null ? `#${p.overall_rank}` : ""}
                </span>
                <span className="flex-1">{p.name}</span>
                <span
                  className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                  style={{
                    color: p.division === "MPO" ? "#4B3DFF" : "#36D7B7",
                    background: p.division === "MPO" ? "rgba(75,61,255,0.18)" : "rgba(54,215,183,0.15)",
                  }}
                >
                  {p.division}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <input
              type="number"
              min={1}
              max={myMaxBid}
              value={openingBid}
              onChange={(e) => setOpeningBid(Number(e.target.value))}
              className="bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-28"
              placeholder="$"
            />
            <button
              type="button"
              onClick={submitNomination}
              disabled={pending || nomineeId == null || openingBid < 1 || openingBid > myMaxBid}
              className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-40"
            >
              {pending ? "Nominating..." : `Nominate for $${openingBid}`}
            </button>
            <p className="text-gray-400 text-xs">Max ${myMaxBid}</p>
          </div>
        </div>
      ) : (
        <div className="bg-[#0f1117] rounded-xl p-5 border border-white/5 text-center">
          <p className="text-gray-400 text-sm">
            Waiting on <span className="text-white font-semibold">{nominator?.team_name ?? "next team"}</span> to nominate…
          </p>
        </div>
      )}
    </div>
  );
}
