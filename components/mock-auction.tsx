"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveMockDraft } from "@/actions/mock-drafts";

type Player = {
  id: number;
  name: string;
  division: "MPO" | "FPO";
  worldRanking: number | null;
  overallRank: number | null;
  totalPoints?: number;
};

/** A completed lot: the player a team won and the price paid. pickNumber is the
 *  order the lot resolved (1-based), used purely for stable sorting/display. */
type WonPick = {
  pickNumber: number;
  teamIndex: number;
  playerId: number;
  price: number;
};

type Lot = {
  playerId: number;
  currentBid: number;
  highBidder: number; // team index
  nominator: number; // team index
};

type Phase = "setup" | "bidding" | "complete";

// Bot bidding cadence. Each tick a single bot either raises or the lot inches
// toward settling; SETTLE_TICKS of silence awards it to the high bidder, which
// also leaves the human a beat to jump in.
const TICK_MS = 450;
const SETTLE_TICKS = 3;
const NOMINATE_DELAY_MS = 700;

/** Bid increments grow as the price climbs so marquee fights don't crawl. */
function bidIncrement(current: number): number {
  if (current < 5) return 1;
  if (current < 15) return 2;
  if (current < 40) return 3;
  return 5;
}

type Props = {
  leagueId: string;
  leagueName: string;
  numTeams: number;
  rosterSize: number;
  mpoStarters: number;
  fpoStarters: number;
  budget: number;
  players: Player[];
  /** When provided, render a previously saved auction read-only. */
  initialMockDraft?: {
    id: number;
    myDraftPosition: number;
    picks: WonPick[];
    createdAt: string;
    status?: "in_progress" | "complete";
  };
};

export function MockAuction({
  leagueId,
  numTeams,
  rosterSize,
  mpoStarters,
  fpoStarters,
  budget,
  players,
  initialMockDraft,
}: Props) {
  const router = useRouter();
  // Saved auctions are always shown read-only; auctions don't support resume
  // mid-bid (the live bid state isn't persisted), so an "in_progress" save is
  // treated as a completed snapshot of what was won so far.
  const isReadOnly = !!initialMockDraft;

  const [phase, setPhase] = useState<Phase>(initialMockDraft ? "complete" : "setup");
  const [myDraftPosition, setMyDraftPosition] = useState<number>(initialMockDraft?.myDraftPosition ?? 1);
  const myTeamIndex = myDraftPosition - 1;

  const [budgets, setBudgets] = useState<number[]>(() => Array.from({ length: numTeams }, () => budget));
  const [wonPicks, setWonPicks] = useState<WonPick[]>(initialMockDraft?.picks ?? []);
  const [lot, setLot] = useState<Lot | null>(null);
  const [nominatorIndex, setNominatorIndex] = useState<number>(0);
  const [idleTicks, setIdleTicks] = useState<number>(0);

  const [search, setSearch] = useState("");
  const [nomineeId, setNomineeId] = useState<number | null>(null);
  const [openingBid, setOpeningBid] = useState(1);
  const [bidAmount, setBidAmount] = useState(0);

  const [savedId, setSavedId] = useState<number | null>(initialMockDraft?.id ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftIdRef = useRef<number | null>(initialMockDraft?.id ?? null);
  const hasSavedRef = useRef(!!initialMockDraft);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exiting, setExiting] = useState(false);

  const playerById = useMemo(() => {
    const m: Record<number, Player> = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  // Roster construction targets, matched to the snake mock's bot logic: bench
  // is split proportionally to the starter ratio.
  const { mpoTarget, fpoTarget } = useMemo(() => {
    const totalStarters = mpoStarters + fpoStarters;
    const benchSize = Math.max(0, rosterSize - totalStarters);
    const benchMpo = totalStarters > 0 ? Math.round((benchSize * mpoStarters) / totalStarters) : 0;
    const benchFpo = benchSize - benchMpo;
    return { mpoTarget: mpoStarters + benchMpo, fpoTarget: fpoStarters + benchFpo };
  }, [mpoStarters, fpoStarters, rosterSize]);

  const takenIds = useMemo(() => new Set(wonPicks.map((p) => p.playerId)), [wonPicks]);

  // Per-team composition (count + per-division counts) derived from won picks.
  const composition = useMemo(() => {
    const comp = Array.from({ length: numTeams }, () => ({ total: 0, MPO: 0, FPO: 0 }));
    for (const p of wonPicks) {
      const c = comp[p.teamIndex];
      if (!c) continue;
      c.total += 1;
      c[playerById[p.playerId]?.division ?? "MPO"] += 1;
    }
    return comp;
  }, [wonPicks, numTeams, playerById]);

  // Players available to nominate, best first (overall rank, then world rank).
  const availableSorted = useMemo(() => {
    return players
      .filter((p) => !takenIds.has(p.id))
      .sort((a, b) => {
        const ar = a.overallRank ?? Number.POSITIVE_INFINITY;
        const br = b.overallRank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        const aw = a.worldRanking ?? Number.POSITIVE_INFINITY;
        const bw = b.worldRanking ?? Number.POSITIVE_INFINITY;
        if (aw !== bw) return aw - bw;
        return a.name.localeCompare(b.name);
      });
  }, [players, takenIds]);

  const teamFull = useCallback(
    (teamIndex: number) => composition[teamIndex].total >= rosterSize,
    [composition, rosterSize],
  );

  // The most a team can still bid while reserving $1 for each of its other open
  // roster slots (so it can always finish filling a legal roster).
  const maxBidFor = useCallback(
    (teamIndex: number) => {
      const openSlots = rosterSize - composition[teamIndex].total;
      if (openSlots <= 0) return 0;
      return Math.max(1, budgets[teamIndex] - (openSlots - 1));
    },
    [budgets, composition, rosterSize],
  );

  // Rank-based base value: a top-overall player is worth ~35% of the budget,
  // decaying exponentially down the board.
  const valueFor = useCallback(
    (player: Player) => {
      const rank = player.overallRank ?? player.worldRanking ?? 100;
      const fraction = Math.exp(-(rank - 1) / 25);
      return Math.max(1, Math.round(budget * 0.35 * fraction));
    },
    [budget],
  );

  // Deterministic per-(team,player) jitter so a bot's valuation is stable across
  // ticks but varies between teams — keeps auctions from feeling identical.
  const jitter = (teamIndex: number, playerId: number) =>
    0.8 + ((teamIndex * 131 + playerId * 17) % 41) / 100;

  // What a bot is willing to pay for a player: 0 if it's full or already has its
  // target count in that division, otherwise its jittered value capped by what
  // it can afford.
  const botValuation = useCallback(
    (teamIndex: number, player: Player) => {
      if (teamFull(teamIndex)) return 0;
      const div = player.division;
      const target = div === "MPO" ? mpoTarget : fpoTarget;
      if (composition[teamIndex][div] >= target) return 0;
      const base = Math.round(valueFor(player) * jitter(teamIndex, player.id));
      return Math.min(base, maxBidFor(teamIndex));
    },
    [teamFull, mpoTarget, fpoTarget, composition, valueFor, maxBidFor],
  );

  // `nominatorIndex` is a raw rotating pointer; the team actually on the clock
  // is the first non-full team at or after it (-1 once everyone is full). This
  // derives from fresh composition, so it can't get stuck on a full team.
  const effectiveNominator = useMemo(() => {
    for (let k = 0; k < numTeams; k++) {
      const idx = (nominatorIndex + k) % numTeams;
      if (composition[idx].total < rosterSize) return idx;
    }
    return -1;
  }, [nominatorIndex, composition, numTeams, rosterSize]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  function start() {
    setBudgets(Array.from({ length: numTeams }, () => budget));
    setWonPicks([]);
    setLot(null);
    setIdleTicks(0);
    // Nomination opens with the first team in draft order.
    setNominatorIndex(0);
    setPhase("bidding");
  }

  const nominate = useCallback((playerId: number, opening: number, byTeam: number) => {
    setLot({ playerId, currentBid: opening, highBidder: byTeam, nominator: byTeam });
    setIdleTicks(0);
  }, []);

  // Award the active lot to its high bidder and move on.
  const awardLot = useCallback(() => {
    setLot((current) => {
      if (!current) return null;
      const { playerId, currentBid, highBidder } = current;
      setBudgets((b) => {
        const next = [...b];
        next[highBidder] = Math.max(0, next[highBidder] - currentBid);
        return next;
      });
      setWonPicks((prev) => [
        ...prev,
        { pickNumber: prev.length + 1, teamIndex: highBidder, playerId, price: currentBid },
      ]);
      return null;
    });
    setIdleTicks(0);
  }, []);

  const isMyNomination = phase === "bidding" && lot == null && effectiveNominator === myTeamIndex;

  // Bot auto-nomination: when it's a bot's turn and no lot is live, it nominates
  // the available player it values most (opening at $1).
  useEffect(() => {
    if (isReadOnly || phase !== "bidding" || lot != null) return;
    if (effectiveNominator < 0 || effectiveNominator === myTeamIndex) return;
    const nom = effectiveNominator;
    const t = setTimeout(() => {
      let best: Player | null = null;
      let bestVal = -1;
      for (const p of availableSorted) {
        const v = botValuation(nom, p);
        if (v > bestVal) {
          bestVal = v;
          best = p;
        }
      }
      // Fallback: if no division is "needed" but the roster still has room, take
      // the best available player the team can afford a $1 bid on.
      if (!best) best = availableSorted.find(() => maxBidFor(nom) >= 1) ?? null;
      if (best) nominate(best.id, 1, nom);
    }, NOMINATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [isReadOnly, phase, lot, effectiveNominator, myTeamIndex, availableSorted, botValuation, maxBidFor, nominate]);

  // Bot bidding / settlement loop while a lot is live. All transitions happen
  // inside the timer callback (never synchronously in the effect body) so a
  // resolved lot doesn't trigger a cascading render.
  useEffect(() => {
    if (isReadOnly || phase !== "bidding" || lot == null) return;

    const t = setTimeout(() => {
      const player = playerById[lot.playerId];
      if (!player) {
        setIdleTicks((n) => n + 1);
        return;
      }
      // Best bot challenger that isn't already the high bidder.
      let challenger = -1;
      let challengerVal = lot.currentBid;
      for (let i = 0; i < numTeams; i++) {
        if (i === lot.highBidder || i === myTeamIndex) continue;
        const v = botValuation(i, player);
        if (v > lot.currentBid && v > challengerVal) {
          challengerVal = v;
          challenger = i;
        }
      }
      if (challenger >= 0) {
        const raise = Math.min(challengerVal, lot.currentBid + bidIncrement(lot.currentBid));
        const next = Math.max(lot.currentBid + 1, raise);
        setLot({ ...lot, currentBid: next, highBidder: challenger });
        setIdleTicks(0);
      } else if (idleTicks + 1 >= SETTLE_TICKS) {
        // Enough silence — award to the standing high bidder and rotate the
        // nomination pointer one past whoever nominated this lot.
        setNominatorIndex((lot.nominator + 1) % numTeams);
        awardLot();
      } else {
        setIdleTicks((n) => n + 1);
      }
    }, TICK_MS);
    return () => clearTimeout(t);
  }, [isReadOnly, phase, lot, idleTicks, numTeams, myTeamIndex, playerById, botValuation, awardLot]);

  // Completion: once every roster is full there are no nominators left. The
  // flip is deferred to a timer callback so it isn't a synchronous setState in
  // the effect body (which would risk a cascading render).
  useEffect(() => {
    if (isReadOnly || phase !== "bidding" || lot != null) return;
    if (!composition.every((c) => c.total >= rosterSize)) return;
    const t = setTimeout(() => setPhase("complete"), 0);
    return () => clearTimeout(t);
  }, [isReadOnly, phase, lot, composition, rosterSize]);

  // Autosave (debounced during bidding, immediate on completion).
  useEffect(() => {
    if (isReadOnly || phase === "setup") return;
    if (phase === "complete" && hasSavedRef.current) return;
    const completed = phase === "complete";
    const persist = async () => {
      try {
        const res = await saveMockDraft(leagueId, {
          id: draftIdRef.current ?? undefined,
          myDraftPosition,
          numTeams,
          rosterSize,
          picks: wonPicks,
          status: completed ? "complete" : "in_progress",
          draftType: "auction",
          auctionBudget: budget,
        });
        draftIdRef.current = res.id;
        setSavedId(res.id);
        if (completed) hasSavedRef.current = true;
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      }
    };
    if (completed) {
      persist();
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(persist, 800);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [isReadOnly, phase, leagueId, myDraftPosition, numTeams, rosterSize, wonPicks, budget]);

  async function exitDraft() {
    if (exiting) return;
    setExiting(true);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      if (phase === "bidding") {
        await saveMockDraft(leagueId, {
          id: draftIdRef.current ?? undefined,
          myDraftPosition,
          numTeams,
          rosterSize,
          picks: wonPicks,
          status: "in_progress",
          draftType: "auction",
          auctionBudget: budget,
        });
      }
    } catch (err) {
      console.error("Failed to save mock auction on exit", err);
    }
    router.push(`/league/${leagueId}/mock-draft`);
  }

  function reset() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    draftIdRef.current = null;
    hasSavedRef.current = false;
    setSavedId(null);
    setBudgets(Array.from({ length: numTeams }, () => budget));
    setWonPicks([]);
    setLot(null);
    setIdleTicks(0);
    setNominatorIndex(0);
    setPhase("setup");
  }

  const teamName = (i: number) => (i === myTeamIndex ? "You" : `Team ${i + 1}`);

  // ── SETUP ────────────────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <Link
            href={`/league/${leagueId}/mock-draft`}
            className="text-gray-400 hover:text-white text-sm transition inline-block mb-4"
          >
            ← Mock Drafts
          </Link>
          <h2 className="text-white font-bold text-xl">Mock Auction</h2>
          <p className="text-gray-400 text-sm mt-1">
            {numTeams} teams · {rosterSize} roster spots · ${budget} budget each · nominate &amp; bid against bots
          </p>
        </div>

        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-4">
          <div>
            <p className="text-white font-semibold text-sm mb-2">Choose your nomination order</p>
            <p className="text-gray-400 text-xs mb-4">
              Teams take turns nominating players in this order. Anyone can bid on any nomination
              until the budget runs out.
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {Array.from({ length: numTeams }, (_, i) => i + 1).map((pos) => {
                const selected = pos === myDraftPosition;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setMyDraftPosition(pos)}
                    className={`py-3 rounded-lg text-sm font-bold transition border ${
                      selected
                        ? "bg-[#4B3DFF] border-[#4B3DFF] text-white"
                        : "bg-[#0f1117] border-white/10 text-gray-300 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={start}
            className="w-full bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold py-3 rounded-lg transition"
          >
            Start Auction
          </button>
        </div>
      </div>
    );
  }

  // ── BIDDING & COMPLETE ─────────────────────────────────────────────────────
  const nominatedPlayer = lot ? playerById[lot.playerId] : null;
  const meIsHighBidder = lot != null && lot.highBidder === myTeamIndex;
  const myMaxBid = maxBidFor(myTeamIndex);
  const myMinBid = (lot?.currentBid ?? 0) + 1;
  const canIBid = lot != null && !meIsHighBidder && !teamFull(myTeamIndex) && myMaxBid >= myMinBid;

  function placeMyBid(amount: number) {
    if (!lot) return;
    if (amount <= lot.currentBid || amount > myMaxBid) return;
    setLot({ ...lot, currentBid: amount, highBidder: myTeamIndex });
    setIdleTicks(0);
    setBidAmount(0);
  }

  function submitNomination() {
    if (nomineeId == null) return;
    if (openingBid < 1 || openingBid > myMaxBid) return;
    nominate(nomineeId, openingBid, myTeamIndex);
    setNomineeId(null);
    setOpeningBid(1);
    setSearch("");
  }

  const nominationList = availableSorted
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 60);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {isReadOnly ? (
            <Link
              href={`/league/${leagueId}/mock-draft`}
              className="text-gray-400 hover:text-white text-sm transition inline-block mb-1"
            >
              ← Mock Drafts
            </Link>
          ) : (
            <button
              type="button"
              onClick={exitDraft}
              disabled={exiting}
              className="text-gray-400 hover:text-white text-sm transition inline-block mb-1 disabled:opacity-50"
            >
              {exiting ? "Saving..." : "← Exit Mock Auction"}
            </button>
          )}
          <h2 className="text-white font-bold text-lg">
            {isReadOnly && initialMockDraft ? (
              <>
                Mock Auction from{" "}
                {new Date(initialMockDraft.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            ) : (
              <>
                Mock Auction{" "}
                {phase === "complete" && <span className="text-[#36D7B7] text-sm font-semibold">· Complete</span>}
              </>
            )}
          </h2>
        </div>
        <span className="text-gray-400 text-xs bg-white/5 px-3 py-1.5 rounded-full">
          Your budget:{" "}
          <span className="text-white font-semibold font-mono">${budgets[myTeamIndex]}</span>
        </span>
      </div>

      {/* Team budgets */}
      <div className="bg-[#1a1d23] rounded-2xl p-4 border border-white/5">
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Budgets</p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: numTeams }, (_, i) => {
            const isNominator = phase === "bidding" && lot == null && i === effectiveNominator;
            const isHigh = lot?.highBidder === i;
            const filled = composition[i].total;
            return (
              <div
                key={i}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                  isHigh
                    ? "bg-[#4B3DFF]/15 border-[#4B3DFF]/40 text-white"
                    : isNominator
                    ? "bg-[#36D7B7]/15 border-[#36D7B7]/40 text-[#36D7B7]"
                    : i === myTeamIndex
                    ? "bg-[#0f1117] border-[#36D7B7]/30 text-gray-200"
                    : "bg-[#0f1117] border-white/5 text-gray-300"
                }`}
              >
                <span className="font-semibold">{teamName(i)}</span>
                <span className="font-mono">${budgets[i]}</span>
                <span className="text-gray-500">{filled}/{rosterSize}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active lot / nomination */}
      {phase === "bidding" && (
        <>
          {lot && nominatedPlayer ? (
            <div className="bg-[#0f1117] rounded-2xl p-5 border border-[#4B3DFF]/30">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">
                    Nominated by {teamName(lot.nominator)}
                  </p>
                  <p className="text-white font-bold text-xl">{nominatedPlayer.name}</p>
                  <p
                    className="text-xs mt-0.5 font-bold uppercase tracking-wider"
                    style={{ color: nominatedPlayer.division === "MPO" ? "#4B3DFF" : "#36D7B7" }}
                  >
                    {nominatedPlayer.division}
                    {nominatedPlayer.overallRank != null && (
                      <span className="text-gray-500 ml-2">#{nominatedPlayer.overallRank} overall</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[#36D7B7] font-mono text-3xl font-black">${lot.currentBid}</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    high: <span className="text-white font-semibold">{teamName(lot.highBidder)}</span>
                    {idleTicks > 0 && !meIsHighBidder && (
                      <span className="text-yellow-300 ml-1">· going {idleTicks >= 2 ? "twice" : "once"}…</span>
                    )}
                  </p>
                </div>
              </div>

              {meIsHighBidder ? (
                <p className="text-[#36D7B7] text-sm font-semibold">
                  You&apos;re the high bidder{idleTicks > 0 ? " — going to you…" : "."}
                </p>
              ) : teamFull(myTeamIndex) ? (
                <p className="text-gray-400 text-sm">Your roster is full — watching the rest play out.</p>
              ) : canIBid ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => placeMyBid(myMinBid)}
                    className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
                  >
                    Bid ${myMinBid}
                  </button>
                  <span className="text-gray-500 text-xs">or</span>
                  <input
                    type="number"
                    min={myMinBid}
                    max={myMaxBid}
                    value={bidAmount || myMinBid}
                    onChange={(e) => setBidAmount(Number(e.target.value))}
                    className="bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-24"
                  />
                  <button
                    type="button"
                    onClick={() => placeMyBid(bidAmount || myMinBid)}
                    className="border border-white/15 hover:border-white/40 text-gray-200 text-sm font-semibold px-3 py-2 rounded-lg transition"
                  >
                    Bid
                  </button>
                  <span className="text-gray-400 text-xs">${myMaxBid} max</span>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">
                  You can&apos;t outbid here (${myMaxBid} max with slots to fill).
                </p>
              )}
            </div>
          ) : isMyNomination ? (
            <div className="bg-[#0f1117] rounded-2xl p-5 border border-[#36D7B7]/30 space-y-3">
              <p className="text-[#36D7B7] font-semibold text-sm">Your turn to nominate</p>
              <input
                type="text"
                placeholder="Search players..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
              <div className="max-h-56 overflow-y-auto space-y-1">
                {nominationList.map((p) => (
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
                      {p.overallRank != null ? `#${p.overallRank}` : ""}
                    </span>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span
                      className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
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
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <input
                  type="number"
                  min={1}
                  max={myMaxBid}
                  value={openingBid}
                  onChange={(e) => setOpeningBid(Number(e.target.value))}
                  className="bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-2 text-white text-sm w-24"
                  placeholder="$"
                />
                <button
                  type="button"
                  onClick={submitNomination}
                  disabled={nomineeId == null || openingBid < 1 || openingBid > myMaxBid}
                  className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-40"
                >
                  Nominate for ${openingBid}
                </button>
                <span className="text-gray-400 text-xs">${myMaxBid} max</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#0f1117] rounded-2xl p-5 border border-white/5 text-center">
              <p className="text-gray-400 text-sm">
                Waiting on <span className="text-white font-semibold">{teamName(effectiveNominator)}</span> to nominate…
              </p>
            </div>
          )}
        </>
      )}

      {/* Completion banner */}
      {phase === "complete" && !isReadOnly && (
        <div className="bg-[#36D7B7]/10 border border-[#36D7B7]/30 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[#36D7B7] font-bold">Mock auction complete</p>
            <p className="text-gray-400 text-xs mt-1">
              You spent ${budget - budgets[myTeamIndex]} on{" "}
              {wonPicks.filter((p) => p.teamIndex === myTeamIndex).length} players.
              {savedId && <span className="text-[#36D7B7]"> · Saved</span>}
              {saveError && <span className="text-red-400"> · Save failed: {saveError}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="border border-white/10 hover:border-white/30 text-gray-300 hover:text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Run another
            </button>
            <Link
              href={`/league/${leagueId}/mock-draft`}
              className="bg-[#4B3DFF] hover:bg-[#3a2eff] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Back to history
            </Link>
          </div>
        </div>
      )}

      {/* Rosters */}
      <RosterBoard
        numTeams={numTeams}
        myTeamIndex={myTeamIndex}
        rosterSize={rosterSize}
        wonPicks={wonPicks}
        playerById={playerById}
        teamName={teamName}
      />
    </div>
  );
}

function RosterBoard({
  numTeams,
  myTeamIndex,
  rosterSize,
  wonPicks,
  playerById,
  teamName,
}: {
  numTeams: number;
  myTeamIndex: number;
  rosterSize: number;
  wonPicks: WonPick[];
  playerById: Record<number, Player>;
  teamName: (i: number) => string;
}) {
  const byTeam = useMemo(() => {
    const m = Array.from({ length: numTeams }, () => [] as WonPick[]);
    for (const p of wonPicks) m[p.teamIndex]?.push(p);
    for (const list of m) list.sort((a, b) => b.price - a.price);
    return m;
  }, [wonPicks, numTeams]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: numTeams }, (_, i) => {
        const list = byTeam[i];
        const spent = list.reduce((s, p) => s + p.price, 0);
        const isMine = i === myTeamIndex;
        return (
          <div
            key={i}
            className={`rounded-2xl border p-4 ${
              isMine ? "bg-[#36D7B7]/5 border-[#36D7B7]/30" : "bg-[#1a1d23] border-white/5"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`font-bold text-sm ${isMine ? "text-[#36D7B7]" : "text-white"}`}>
                {teamName(i)}
              </span>
              <span className="text-gray-400 text-xs font-mono">
                {list.length}/{rosterSize} · ${spent}
              </span>
            </div>
            <div className="space-y-1">
              {list.length === 0 ? (
                <p className="text-gray-500 text-xs italic">No players yet</p>
              ) : (
                list.map((p) => {
                  const player = playerById[p.playerId];
                  const color = player?.division === "MPO" ? "#4B3DFF" : "#36D7B7";
                  return (
                    <div key={p.playerId} className="flex items-center gap-2 text-xs">
                      <span
                        className="text-[9px] font-bold uppercase px-1 py-0.5 rounded shrink-0"
                        style={{ color, background: `${color}20` }}
                      >
                        {player?.division ?? "—"}
                      </span>
                      <span className="text-white truncate flex-1">{player?.name ?? "Unknown"}</span>
                      <span className="text-gray-400 font-mono shrink-0">${p.price}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
