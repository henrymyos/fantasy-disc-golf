"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  saveMockDraft,
  shareMockDraft,
  joinMockDraft,
  leaveMockDraftSeat,
  startSharedMockDraft,
  makeSharedMockPick,
  getMockDraftState,
} from "@/actions/mock-drafts";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { MockSeats } from "@/lib/mock-draft-types";

type Player = {
  id: number;
  name: string;
  division: "MPO" | "FPO";
  worldRanking: number | null;
  overallRank: number | null;
  totalPoints?: number;
};

type Pick = {
  pickNumber: number;     // 1-based overall pick number
  round: number;          // 1-based
  teamIndex: number;      // 0-based team index
  playerId: number | null;
};

// "lobby" is the pre-start staging area: the board is visible (with empty
// slots) but nobody is on the clock yet. Solo drafts pass through it briefly;
// shared drafts sit here while friends claim seats.
type Phase = "setup" | "lobby" | "drafting" | "complete";

type DivisionTab = "all" | "mpo" | "fpo";
type BottomTab = "available" | "team";
type PanelSize = "small" | "medium" | "large";

const PANEL_HEIGHTS: Record<PanelSize, number> = { small: 180, medium: 300, large: 540 };
const PANEL_ORDER: PanelSize[] = ["small", "medium", "large"];

const BOT_PICK_DELAY_MS = 1000;
// Backstop refresh for shared drafts in case a Realtime event is dropped.
const SHARED_POLL_MS = 4000;

/** Whether the given 1-based round runs in reverse draft order. Rounds 1 and 2
 *  always stay normal snake; with third-round reversal on, every round from 3
 *  inverts the standard snake direction. Mirrors lib/snake-order.ts. */
function isRoundReversed(round: number, thirdRoundReversal: boolean): boolean {
  let reversed = round % 2 === 0;
  if (thirdRoundReversal && round >= 3) reversed = !reversed;
  return reversed;
}

/** Snake order: returns the 0-based team index for a given 0-based pick index. */
function teamIndexForPick(pickIndex: number, numTeams: number, thirdRoundReversal: boolean): number {
  const round = Math.floor(pickIndex / numTeams) + 1; // 1-based round
  const slot = pickIndex % numTeams;
  return isRoundReversed(round, thirdRoundReversal) ? numTeams - 1 - slot : slot;
}

/** Builds the per-team pick numbers for a snake draft. */
function pickNumberFor(
  round: number,
  draftPosition: number,
  numTeams: number,
  thirdRoundReversal: boolean,
): number {
  // round is 1-based, draftPosition is 1-based
  const reversed = isRoundReversed(round, thirdRoundReversal);
  return (round - 1) * numTeams + (reversed ? numTeams - draftPosition + 1 : draftPosition);
}

/** Index of the first unfilled pick, or the total count if the board is full. */
function firstOpenIndex(picks: Pick[], totalPicks: number): number {
  const i = picks.findIndex((p) => p.playerId == null);
  return i === -1 ? totalPicks : i;
}

type Props = {
  leagueId: string;
  leagueName: string;
  numTeams: number;
  rosterSize: number;
  mpoStarters: number;
  fpoStarters: number;
  players: Player[];
  /** Mirrors the league's live snake setting. */
  thirdRoundReversal?: boolean;
  /** The signed-in viewer, used to figure out which seat is theirs and whether
   *  they're the host of a shared draft. */
  currentUserId: string;
  /** When provided, hydrate from a previously saved draft. */
  initialMockDraft?: {
    id: number;
    myDraftPosition: number;
    picks: { pickNumber: number; teamIndex: number; playerId: number | null }[];
    createdAt: string;
    /** "lobby" → shared lobby; "in_progress" → live/resumable; "complete" →
     *  read-only finished run. */
    status?: "lobby" | "in_progress" | "complete";
    /** Shared (multiplayer) draft fields. */
    isShared?: boolean;
    hostId?: string;
    seats?: MockSeats;
  };
};

export function MockDraft({
  leagueId,
  leagueName,
  numTeams,
  rosterSize,
  mpoStarters,
  fpoStarters,
  players,
  thirdRoundReversal = false,
  currentUserId,
  initialMockDraft,
}: Props) {
  // A completed initial draft is shown read-only; an in-progress one is
  // resumed in editable mode.
  const isReadOnly = !!initialMockDraft && initialMockDraft.status === "complete";

  const totalPicks = numTeams * rosterSize;

  const [phase, setPhase] = useState<Phase>(() => {
    if (!initialMockDraft) return "setup";
    if (initialMockDraft.status === "lobby") return "lobby";
    if (initialMockDraft.status === "in_progress") return "drafting";
    return "complete";
  });
  const [myDraftPosition, setMyDraftPosition] = useState<number>(initialMockDraft?.myDraftPosition ?? 1);
  const [picks, setPicks] = useState<Pick[]>(() => {
    if (!initialMockDraft) return [];
    return initialMockDraft.picks.map((p) => ({
      pickNumber: p.pickNumber,
      round: Math.ceil(p.pickNumber / numTeams),
      teamIndex: p.teamIndex,
      playerId: p.playerId,
    }));
  });
  const [currentPickIndex, setCurrentPickIndex] = useState<number>(() => {
    if (!initialMockDraft) return 0;
    // Resume from the first slot that hasn't been filled yet.
    const firstEmpty = initialMockDraft.picks.findIndex((p) => p.playerId == null);
    return firstEmpty === -1 ? numTeams * rosterSize : firstEmpty;
  });
  const [divTab, setDivTab] = useState<DivisionTab>("all");
  const [bottomTab, setBottomTab] = useState<BottomTab>(isReadOnly ? "team" : "available");
  const [search, setSearch] = useState<string>("");
  const [panelSize, setPanelSize] = useState<PanelSize>("medium");
  const [savedId, setSavedId] = useState<number | null>(initialMockDraft?.id ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const myColRef = useRef<HTMLDivElement | null>(null);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedRef = useRef(!!initialMockDraft && initialMockDraft.status === "complete");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<number | null>(initialMockDraft?.id ?? null);
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  // Shared / multiplayer state.
  const [isShared, setIsShared] = useState<boolean>(initialMockDraft?.isShared ?? false);
  const [seats, setSeats] = useState<MockSeats>(initialMockDraft?.seats ?? {});
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied">("idle");
  const [seatBusy, setSeatBusy] = useState(false);
  const [pickPending, setPickPending] = useState(false);
  // The host owns the row; only the host's browser drives bot picks and can
  // start the draft. A freshly created (unsaved) draft belongs to the viewer.
  const hostId = initialMockDraft?.hostId ?? currentUserId;
  const isHost = hostId === currentUserId;

  // Sort master list to mirror the live draft board: total fantasy points this
  // season is the primary key (descending), with overallRank/worldRanking/name
  // as tiebreakers for players who haven't scored yet.
  const sortedAll = useMemo(() => {
    const copy = [...players];
    copy.sort((a, b) => {
      const pa = a.totalPoints ?? 0;
      const pb = b.totalPoints ?? 0;
      if (pa !== pb) return pb - pa;
      const ar = a.overallRank ?? Number.POSITIVE_INFINITY;
      const br = b.overallRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      const aw = a.worldRanking ?? Number.POSITIVE_INFINITY;
      const bw = b.worldRanking ?? Number.POSITIVE_INFINITY;
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [players]);

  const playerById = useMemo(() => {
    const m: Record<number, Player> = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const p of picks) if (p.playerId != null) s.add(p.playerId);
    return s;
  }, [picks]);

  const availableSorted = useMemo(
    () => sortedAll.filter((p) => !takenIds.has(p.id)),
    [sortedAll, takenIds]
  );

  // In a shared draft the seat the viewer claimed defines "their" team; solo
  // drafts use the position chosen in setup.
  const mySeatIndex = useMemo(() => {
    for (const [k, s] of Object.entries(seats)) if (s.userId === currentUserId) return Number(k);
    return -1;
  }, [seats, currentUserId]);
  const myTeamIndex = isShared ? mySeatIndex : myDraftPosition - 1;

  // In shared mode the picks array (kept in sync from the DB) is the single
  // source of truth for who's on the clock; solo mode tracks it locally.
  const livePickIndex = useMemo(() => firstOpenIndex(picks, totalPicks), [picks, totalPicks]);
  const currentPick = isShared ? livePickIndex : currentPickIndex;

  const onClockTeamIndex =
    phase === "drafting"
      ? isShared
        ? picks[currentPick]?.teamIndex ?? -1
        : teamIndexForPick(currentPickIndex, numTeams, thirdRoundReversal)
      : -1;
  const isMyTurn = phase === "drafting" && myTeamIndex >= 0 && onClockTeamIndex === myTeamIndex;
  const currentRound = Math.floor(currentPick / numTeams) + 1;
  const seatedCount = Object.keys(seats).length;

  /** Display label + "is this me" for a team column / seat. */
  const labelForTeam = useCallback(
    (teamIdx: number): { text: string; mine: boolean; bot: boolean } => {
      const mine = teamIdx === myTeamIndex;
      if (isShared) {
        const s = seats[String(teamIdx)];
        if (!s) return { text: "Bot", mine: false, bot: true };
        return { text: mine ? "You" : s.name, mine, bot: false };
      }
      return { text: mine ? "You" : `Team ${teamIdx + 1}`, mine, bot: false };
    },
    [isShared, seats, myTeamIndex],
  );

  function buildEmptyBoard(): Pick[] {
    const empty: Pick[] = [];
    for (let i = 0; i < totalPicks; i++) {
      empty.push({
        pickNumber: i + 1,
        round: Math.floor(i / numTeams) + 1,
        teamIndex: teamIndexForPick(i, numTeams, thirdRoundReversal),
        playerId: null,
      });
    }
    return empty;
  }

  // Setup → lobby. The board is laid out now but nobody is on the clock until
  // the draft is actually started.
  function start() {
    setPicks(buildEmptyBoard());
    setCurrentPickIndex(0);
    setPhase("lobby");
  }

  function makePick(playerId: number) {
    if (phase !== "drafting") return;

    if (isShared) {
      if (!isMyTurn || pickPending || draftIdRef.current == null) return;
      setPickPending(true);
      makeSharedMockPick(draftIdRef.current, playerId)
        .catch((err) => setSaveError(err instanceof Error ? err.message : "Pick failed"))
        .finally(() => setPickPending(false));
      return;
    }

    if (currentPickIndex >= totalPicks) return;
    setPicks((prev) => {
      const next = [...prev];
      if (next[currentPickIndex].playerId != null) return prev;
      next[currentPickIndex] = { ...next[currentPickIndex], playerId };
      return next;
    });
    setCurrentPickIndex((idx) => idx + 1);
  }

  // Pick a player for the bot on the clock. Instead of blindly taking the top
  // overall-ranked player, the bot respects its target roster composition so
  // it doesn't (e.g.) draft 7 FPO when the lineup only fits 2.
  // Target = starters + bench split proportionally to the starter ratio
  // (so 4 MPO / 2 FPO starters with 4 bench slots → 7 MPO / 3 FPO total).
  const pickForBot = useCallback(
    (teamIndex: number): number | undefined => {
      let mpoCount = 0;
      let fpoCount = 0;
      for (const p of picks) {
        if (p.teamIndex !== teamIndex || p.playerId == null) continue;
        const div = playerById[p.playerId]?.division;
        if (div === "MPO") mpoCount++;
        else if (div === "FPO") fpoCount++;
      }

      const totalStarters = mpoStarters + fpoStarters;
      const benchSize = Math.max(0, rosterSize - totalStarters);
      const benchMpo = totalStarters > 0 ? Math.round((benchSize * mpoStarters) / totalStarters) : 0;
      const benchFpo = benchSize - benchMpo;
      const mpoTarget = mpoStarters + benchMpo;
      const fpoTarget = fpoStarters + benchFpo;

      // Pool of available players whose division still has a slot. If both
      // divisions are already at target (rounding quirk) fall back to the full
      // list so the bot still makes a pick.
      const eligible = availableSorted.filter(
        (p) =>
          (p.division === "MPO" && mpoCount < mpoTarget) ||
          (p.division === "FPO" && fpoCount < fpoTarget),
      );
      const pool = eligible.length > 0 ? eligible : availableSorted;

      // Mostly take the top of the pool (75%), occasionally reach for #2-#4 so
      // mock drafts feel less robotic. Weights: 75 / 15 / 7 / 3.
      const r = Math.random();
      const idx = r < 0.75 ? 0 : r < 0.9 ? 1 : r < 0.97 ? 2 : 3;
      return pool[Math.min(idx, pool.length - 1)]?.id;
    },
    [picks, playerById, availableSorted, mpoStarters, fpoStarters, rosterSize],
  );

  // Local (solo) bot loop — disabled for shared drafts, which drive bots from
  // the host's browser instead (see below).
  useEffect(() => {
    if (isReadOnly || isShared) return;
    if (phase !== "drafting") return;
    if (currentPickIndex >= totalPicks) {
      setPhase("complete");
      return;
    }
    if (onClockTeamIndex === myTeamIndex) return; // user's turn

    botTimer.current = setTimeout(() => {
      const pid = pickForBot(onClockTeamIndex);
      if (pid != null) makePick(pid);
    }, BOT_PICK_DELAY_MS);

    return () => {
      if (botTimer.current) clearTimeout(botTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentPickIndex, onClockTeamIndex, myTeamIndex, availableSorted, totalPicks, isShared]);

  // Shared draft: subscribe to the row over Realtime and poll as a backstop, so
  // every participant sees seats fill and picks land live.
  useEffect(() => {
    if (!isShared || savedId == null) return;
    const id = savedId;
    let cancelled = false;

    const applyState = (state: {
      picks: { pickNumber: number; teamIndex: number; playerId: number | null }[];
      seats: MockSeats;
      status: string;
    }) => {
      if (cancelled) return;
      setPicks(
        (state.picks ?? []).map((p) => ({
          pickNumber: p.pickNumber,
          round: Math.ceil(p.pickNumber / numTeams),
          teamIndex: p.teamIndex,
          playerId: p.playerId,
        })),
      );
      setSeats(state.seats ?? {});
      setPhase(
        state.status === "lobby" ? "lobby" : state.status === "complete" ? "complete" : "drafting",
      );
    };

    getMockDraftState(id)
      .then((s) => s && applyState(s))
      .catch(() => {});

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`mock_draft_${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mock_drafts", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as {
            picks?: { pickNumber: number; teamIndex: number; playerId: number | null }[];
            seats?: MockSeats;
            status?: string;
          };
          applyState({ picks: row.picks ?? [], seats: row.seats ?? {}, status: row.status ?? "lobby" });
        },
      )
      .subscribe();

    const poll = setInterval(() => {
      getMockDraftState(id)
        .then((s) => s && applyState(s))
        .catch(() => {});
    }, SHARED_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [isShared, savedId, numTeams]);

  // Shared draft: the host's browser drafts for any unclaimed (bot) seat. A
  // single driver avoids two clients racing to pick for the same bot.
  useEffect(() => {
    if (!isShared || !isHost || phase !== "drafting") return;
    if (currentPick >= totalPicks) return;
    const teamIdx = picks[currentPick]?.teamIndex;
    if (teamIdx == null) return;
    if (seats[String(teamIdx)]) return; // a human owns this seat
    const id = draftIdRef.current;
    if (id == null) return;

    const timer = setTimeout(() => {
      const pid = pickForBot(teamIdx);
      if (pid != null) makeSharedMockPick(id, pid).catch(() => {});
    }, BOT_PICK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isShared, isHost, phase, currentPick, picks, seats, totalPicks, pickForBot]);

  // Scroll the board to keep the current row in view
  useEffect(() => {
    if (phase !== "drafting" || !boardRef.current) return;
    const row = boardRef.current.querySelector<HTMLDivElement>(`[data-round="${currentRound}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentRound, phase]);

  // On mobile the board scrolls horizontally; nudge the viewer's own team
  // column into view once the board is shown so they don't have to hunt for it.
  useEffect(() => {
    if (phase === "setup" || myTeamIndex < 0) return;
    myColRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [phase, myTeamIndex]);

  // Autosave solo drafts during drafting (debounced) and once on completion.
  // Shared drafts are persisted server-side on every action, so they skip this.
  useEffect(() => {
    if (isReadOnly || isShared) return;
    if (phase === "setup" || phase === "lobby") return;
    if (phase === "complete" && hasSavedRef.current) return;

    const completed = phase === "complete";
    const persist = async () => {
      try {
        const res = await saveMockDraft(leagueId, {
          id: draftIdRef.current ?? undefined,
          myDraftPosition,
          numTeams,
          rosterSize,
          picks: picks.map((p) => ({
            pickNumber: p.pickNumber,
            teamIndex: p.teamIndex,
            playerId: p.playerId,
          })),
          status: completed ? "complete" : "in_progress",
          draftType: "snake",
          thirdRoundReversal,
        });
        draftIdRef.current = res.id;
        setSavedId(res.id);
        if (completed) hasSavedRef.current = true;
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      }
    };

    // Fire immediately on completion; otherwise debounce a bit so we don't
    // hammer the DB on every bot pick.
    if (completed) {
      persist();
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(persist, 600);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [phase, isReadOnly, isShared, leagueId, myDraftPosition, numTeams, rosterSize, picks, thirdRoundReversal]);

  // Promote the draft to a shareable lobby and copy the invite link. Creates
  // the row on first share. Host only.
  async function handleShare() {
    if (!isHost || shareState === "sharing") return;
    setShareState("sharing");
    setSaveError(null);
    try {
      const hostSeatIndex = isShared
        ? mySeatIndex >= 0
          ? mySeatIndex
          : 0
        : myDraftPosition - 1;
      const res = await shareMockDraft(leagueId, {
        id: draftIdRef.current ?? undefined,
        numTeams,
        rosterSize,
        hostSeatIndex,
        thirdRoundReversal,
      });
      draftIdRef.current = res.id;
      setSavedId(res.id);
      setIsShared(true);
      const url = `${window.location.origin}/league/${leagueId}/mock-draft/${res.id}/live`;
      try {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        setTimeout(() => setShareState("idle"), 2500);
      } catch {
        setShareState("idle");
        window.prompt("Copy this invite link:", url);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't share draft");
      setShareState("idle");
    }
  }

  async function handleClaimSeat(teamIdx: number) {
    if (seatBusy || draftIdRef.current == null) return;
    setSeatBusy(true);
    setSaveError(null);
    try {
      await joinMockDraft(draftIdRef.current, teamIdx);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't claim seat");
    } finally {
      setSeatBusy(false);
    }
  }

  async function handleLeaveSeat() {
    if (seatBusy || draftIdRef.current == null) return;
    setSeatBusy(true);
    try {
      await leaveMockDraftSeat(draftIdRef.current);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't leave seat");
    } finally {
      setSeatBusy(false);
    }
  }

  async function handleStart() {
    if (isShared) {
      if (!isHost || draftIdRef.current == null) return;
      try {
        await startSharedMockDraft(draftIdRef.current);
        setPhase("drafting"); // optimistic; Realtime confirms
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't start draft");
      }
      return;
    }
    setPhase("drafting");
  }

  // Saves the current state immediately and navigates to the mock-draft hub.
  // Works at any time — bots may have a pick in flight, but their pending
  // timer is cancelled and we persist exactly what's been picked so far.
  async function exitDraft() {
    if (exiting) return;
    setExiting(true);
    if (botTimer.current) clearTimeout(botTimer.current);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      // Shared drafts are already persisted on every action; only solo drafts
      // need a final flush here.
      if (!isShared && phase === "drafting") {
        await saveMockDraft(leagueId, {
          id: draftIdRef.current ?? undefined,
          myDraftPosition,
          numTeams,
          rosterSize,
          picks: picks.map((p) => ({
            pickNumber: p.pickNumber,
            teamIndex: p.teamIndex,
            playerId: p.playerId,
          })),
          status: "in_progress",
          draftType: "snake",
          thirdRoundReversal,
        });
      }
    } catch (err) {
      // Best-effort save; still let the user out either way.
      console.error("Failed to save mock draft on exit", err);
    }
    router.push(`/league/${leagueId}/mock-draft`);
  }

  // ── SETUP PHASE ───────────────────────────────────────────────────────────
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
          <h2 className="text-white font-bold text-xl">Mock Draft</h2>
          <p className="text-gray-400 text-sm mt-1">
            {numTeams} teams · {rosterSize} rounds · snake order{thirdRoundReversal ? " (3rd-round reversal)" : ""} · bots take {(BOT_PICK_DELAY_MS / 1000).toFixed(0)}s per pick
          </p>
        </div>

        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-4">
          <div>
            <p className="text-white font-semibold text-sm mb-2">Choose your draft position</p>
            <p className="text-gray-400 text-xs mb-4">
              Pick 1 goes first overall; pick {numTeams} goes last. Snake reverses each round
              {thirdRoundReversal ? ", and the direction inverts again from round 3 onward." : "."}
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
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ── LOBBY / DRAFTING / COMPLETE PHASES ────────────────────────────────────
  const myPicks = picks.filter((p) => p.teamIndex === myTeamIndex && p.playerId != null);

  const panelIdx = PANEL_ORDER.indexOf(panelSize);
  const canEnlarge = panelIdx < PANEL_ORDER.length - 1;
  const canShrink = panelIdx > 0;
  const panelHeight = PANEL_HEIGHTS[panelSize];
  const showPanel = phase !== "lobby";

  return (
    <div className="space-y-4" style={{ paddingBottom: (showPanel ? panelHeight : 0) + 32 }}>
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
              {exiting ? "Saving..." : "← Exit Mock Draft"}
            </button>
          )}
          <h2 className="text-white font-bold text-lg">
            {isReadOnly && initialMockDraft ? (
              <>
                Mock Draft from{" "}
                {new Date(initialMockDraft.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            ) : (
              <>
                {isShared ? "Shared Mock Draft" : "Mock Draft"}{" "}
                {phase === "complete" && <span className="text-[#36D7B7] text-sm font-semibold">· Complete</span>}
              </>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs bg-white/5 px-3 py-1.5 rounded-full">
            {isShared ? (
              myTeamIndex >= 0 ? (
                <>Your team: <span className="text-white font-semibold">#{myTeamIndex + 1}</span></>
              ) : (
                <span className="text-white font-semibold">Spectating</span>
              )
            ) : (
              <>Your pick: <span className="text-white font-semibold">#{myDraftPosition}</span></>
            )}
          </span>
        </div>
      </div>

      {/* Lobby controls */}
      {phase === "lobby" && (
        <div className="bg-[#1a1d23] rounded-2xl border border-white/5 p-5 space-y-4">
          {!isShared ? (
            <>
              <div>
                <p className="text-white font-semibold">Ready when you are</p>
                <p className="text-gray-400 text-sm mt-1">
                  You&apos;re drafting from spot #{myDraftPosition}. Start solo against bots, or share a
                  link to draft live with friends — whoever joins claims an open team, and the rest
                  are filled by bots.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStart}
                  className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold py-2.5 px-5 rounded-lg transition"
                >
                  Start Draft
                </button>
                {isHost && (
                  <button
                    type="button"
                    onClick={handleShare}
                    disabled={shareState === "sharing"}
                    className="border border-[#4B3DFF] text-[#9b91ff] hover:bg-[#4B3DFF]/10 font-semibold py-2.5 px-5 rounded-lg transition disabled:opacity-50"
                  >
                    {shareState === "sharing" ? "Sharing…" : "Share to draft live"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-white font-semibold">Draft lobby</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {seatedCount} of {numTeams} {seatedCount === 1 ? "team" : "teams"} claimed · the
                    rest draft as bots.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleShare}
                    disabled={shareState === "sharing"}
                    className="border border-white/10 hover:border-white/30 text-gray-300 hover:text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                  >
                    {shareState === "copied" ? "Link copied!" : "Copy invite link"}
                  </button>
                  {isHost && (
                    <button
                      type="button"
                      onClick={handleStart}
                      className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold text-sm px-5 py-2 rounded-lg transition"
                    >
                      Start Draft
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: numTeams }, (_, i) => {
                  const s = seats[String(i)];
                  const mine = s?.userId === currentUserId;
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                        mine
                          ? "border-[#36D7B7]/40 bg-[#36D7B7]/10"
                          : s
                          ? "border-white/10 bg-[#0f1117]"
                          : "border-dashed border-white/15 bg-[#0f1117]/60"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                          Team {i + 1}
                        </p>
                        <p className="text-sm text-white truncate">
                          {s ? (
                            <>
                              {mine ? "You" : s.name}
                              {s.isHost && <span className="text-gray-400"> · host</span>}
                            </>
                          ) : (
                            <span className="text-gray-500 italic">Open</span>
                          )}
                        </p>
                      </div>
                      {!s ? (
                        <button
                          type="button"
                          onClick={() => handleClaimSeat(i)}
                          disabled={seatBusy}
                          className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1 rounded-full transition disabled:opacity-50 shrink-0"
                        >
                          Claim
                        </button>
                      ) : mine && !s.isHost ? (
                        <button
                          type="button"
                          onClick={handleLeaveSeat}
                          disabled={seatBusy}
                          className="text-[11px] text-gray-400 hover:text-white transition disabled:opacity-50 shrink-0"
                        >
                          Leave
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {!isHost && (
                <p className="text-gray-400 text-xs">
                  {myTeamIndex >= 0
                    ? "You're in. Waiting for the host to start the draft…"
                    : "Claim an open team above, then wait for the host to start."}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* On the clock banner */}
      {phase === "drafting" && (
        <div
          className={`rounded-xl px-4 py-3 border ${
            isMyTurn
              ? "bg-[#36D7B7]/15 border-[#36D7B7]/40"
              : "bg-[#0f1117] border-white/10"
          }`}
        >
          <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">
            Round {currentRound} · Pick {currentPick + 1} of {totalPicks}
          </p>
          <p className="text-base font-bold mt-0.5">
            {isMyTurn ? (
              <span className="text-[#36D7B7]">You&apos;re on the clock</span>
            ) : (
              <span className="text-white">
                {(() => {
                  const l = labelForTeam(onClockTeamIndex);
                  return `${l.bot ? `Team ${onClockTeamIndex + 1} (bot)` : l.text} is picking…`;
                })()}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Draft board grid */}
      <div className="bg-[#1a1d23] rounded-2xl border border-white/5 overflow-hidden">
        <div
          ref={boardRef}
          className="overflow-x-auto overflow-y-auto max-h-[60vh]"
        >
          {/* Column header (team labels) */}
          <div
            className="grid sticky top-0 z-10 bg-[#1a1d23] border-b border-white/10"
            style={{
              gridTemplateColumns: `48px repeat(${numTeams}, minmax(120px, 1fr))`,
            }}
          >
            <div className="text-[10px] font-bold uppercase text-gray-400 px-2 py-2 sticky left-0 z-20 bg-[#1a1d23]">Rd</div>
            {Array.from({ length: numTeams }, (_, i) => {
              const l = labelForTeam(i);
              return (
                <div
                  key={i}
                  ref={l.mine ? myColRef : undefined}
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-2 text-center truncate ${
                    l.mine ? "text-[#36D7B7]" : "text-gray-400"
                  }`}
                  title={l.text}
                >
                  {l.text}
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {Array.from({ length: rosterSize }, (_, roundIdx) => {
            const round = roundIdx + 1;
            return (
              <div
                key={round}
                data-round={round}
                className="grid border-b border-white/5 last:border-0"
                style={{
                  gridTemplateColumns: `48px repeat(${numTeams}, minmax(120px, 1fr))`,
                }}
              >
                <div className="text-xs font-bold text-gray-400 px-2 py-2 flex items-center sticky left-0 z-[5] bg-[#1a1d23]">
                  R{round}
                </div>
                {Array.from({ length: numTeams }, (_, teamIdx) => {
                  // Find the pick belonging to this (round, teamIdx)
                  const pickNumber = pickNumberFor(round, teamIdx + 1, numTeams, thirdRoundReversal);
                  const pick = picks[pickNumber - 1];
                  const isCurrent = phase === "drafting" && pick && currentPick === pickNumber - 1;
                  const isMine = teamIdx === myTeamIndex;
                  const player = pick?.playerId ? playerById[pick.playerId] : null;
                  const isMpo = player?.division === "MPO";
                  const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";

                  return (
                    <div
                      key={teamIdx}
                      className={`px-2 py-1.5 min-h-[58px] flex flex-col justify-center text-xs border-l border-white/5 ${
                        isCurrent ? "bg-[#36D7B7]/10" : ""
                      } ${isMine ? "bg-[#36D7B7]/5" : ""}`}
                      style={
                        player
                          ? { background: `${accentColor}18` }
                          : {}
                      }
                    >
                      <div className="text-[10px] text-gray-400 font-mono">
                        #{pickNumber}
                      </div>
                      {player ? (
                        <div className="min-w-0">
                          <div
                            className="text-white font-semibold text-xs truncate"
                            title={player.name}
                          >
                            {player.name}
                          </div>
                          <div
                            className="text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: accentColor }}
                          >
                            {player.division}
                          </div>
                        </div>
                      ) : (
                        <div className={`text-[10px] ${isCurrent ? "text-[#36D7B7]" : "text-gray-400"}`}>
                          {isCurrent ? "On clock" : "—"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabbed bottom panel: Available / My Team — hidden in the lobby. */}
      {showPanel && (
      <div
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4rem)] md:bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 flex flex-col transition-[height] duration-200"
        style={{ height: panelHeight }}
      >
          {/* Tab header */}
          <div className="flex items-center flex-wrap gap-2 px-3 lg:px-6 py-2 border-b border-white/5 shrink-0">
            <div className="flex flex-col -my-1">
              <button
                type="button"
                onClick={() => canEnlarge && setPanelSize(PANEL_ORDER[panelIdx + 1])}
                disabled={!canEnlarge}
                className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
                title="Enlarge"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => canShrink && setPanelSize(PANEL_ORDER[panelIdx - 1])}
                disabled={!canShrink}
                className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed leading-none"
                title="Shrink"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <div className="flex gap-1 bg-[#1a1d23] rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setBottomTab("available")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  bottomTab === "available" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Available ({availableSorted.length})
              </button>
              <button
                type="button"
                onClick={() => setBottomTab("team")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  bottomTab === "team" ? "bg-[#4B3DFF] text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                My Team ({myPicks.length})
              </button>
            </div>

            {bottomTab === "available" && (
              <div className="ml-auto flex flex-col-reverse sm:flex-row sm:items-center gap-2">
                <div className="flex gap-1 bg-[#1a1d23] rounded-lg p-0.5 w-48 sm:w-auto">
                  {(["all", "mpo", "fpo"] as DivisionTab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDivTab(t)}
                      className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition ${
                        t === divTab
                          ? t === "mpo"
                            ? "bg-[#4B3DFF] text-white"
                            : t === "fpo"
                            ? "bg-[#36D7B7] text-black"
                            : "bg-white/10 text-white"
                          : "text-gray-400 hover:text-gray-300"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[#1a1d23] border border-white/10 rounded-lg px-3 py-1 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] w-48 sm:w-32"
                />
              </div>
            )}

            {isMyTurn && (
              <span className="ml-auto text-[#36D7B7] font-bold text-xs animate-pulse">
                {bottomTab === "available" ? "Click a player to draft" : "Switch to Available to draft"}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {bottomTab === "available" ? (
              <AvailableList
                players={availableSorted}
                divTab={divTab}
                search={search}
                isMyTurn={isMyTurn && phase === "drafting" && !pickPending}
                onPick={makePick}
              />
            ) : (
              <TeamList
                picks={myPicks}
                playerById={playerById}
                mpoSlots={mpoStarters}
                fpoSlots={fpoStarters}
                rosterSize={rosterSize}
              />
            )}
          </div>
        </div>
      )}

      {phase === "complete" && !isReadOnly && (
        <div className="bg-[#36D7B7]/10 border border-[#36D7B7]/30 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[#36D7B7] font-bold">Mock draft complete</p>
            <p className="text-gray-400 text-xs mt-1">
              {myTeamIndex >= 0
                ? `You drafted ${myPicks.length} players across ${rosterSize} rounds.`
                : `${totalPicks} picks across ${rosterSize} rounds.`}
              {!isShared && savedId && <span className="text-[#36D7B7]"> · Saved</span>}
              {saveError && <span className="text-red-400"> · {saveError}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/league/${leagueId}/mock-draft`}
              className="border border-white/10 hover:border-white/30 text-gray-300 hover:text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Back to history
            </Link>
            <Link
              href={`/league/${leagueId}/mock-draft/new`}
              className="bg-[#4B3DFF] hover:bg-[#3a2eff] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Run another
            </Link>
          </div>
        </div>
      )}

      {saveError && phase !== "complete" && (
        <p className="text-red-400 text-xs">{saveError}</p>
      )}
    </div>
  );
}

function AvailableList({
  players,
  divTab,
  search,
  isMyTurn,
  onPick,
}: {
  players: Player[];
  divTab: DivisionTab;
  search: string;
  isMyTurn: boolean;
  onPick: (id: number) => void;
}) {
  const filtered = players
    .filter((p) => (divTab === "all" ? true : divTab === "mpo" ? p.division === "MPO" : p.division === "FPO"))
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  if (filtered.length === 0) {
    return <p className="text-gray-400 text-xs text-center py-6">No players found</p>;
  }

  return (
    <>
      {filtered.map((player) => {
        const rank = divTab === "all" ? player.overallRank : player.worldRanking;
        const isMpo = player.division === "MPO";
        const accentColor = isMpo ? "#4B3DFF" : "#36D7B7";
        return (
          <div
            key={player.id}
            className="flex items-center gap-3 px-3 lg:px-6 py-2 border-b border-white/5 hover:bg-white/5 transition"
          >
            {isMyTurn ? (
              <button
                type="button"
                onClick={() => onPick(player.id)}
                className="text-xs bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white px-3 py-1 rounded-full transition shrink-0 -mr-2"
              >
                Draft
              </button>
            ) : (
              <span className="w-[58px] shrink-0 -mr-2" />
            )}
            <span className="text-gray-400 text-xs font-mono w-8 text-right shrink-0">
              {rank != null ? `#${rank}` : ""}
            </span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-white text-sm truncate min-w-0">{player.name}</span>
              <span
                className="text-[10px] font-bold uppercase shrink-0"
                style={{ color: accentColor }}
              >
                {player.division}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function TeamList({
  picks,
  playerById,
  mpoSlots,
  fpoSlots,
  rosterSize,
}: {
  picks: Pick[];
  playerById: Record<number, Player>;
  mpoSlots: number;
  fpoSlots: number;
  rosterSize: number;
}) {
  const ordered = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);
  const mpo = ordered.filter((p) => playerById[p.playerId!]?.division === "MPO");
  const fpo = ordered.filter((p) => playerById[p.playerId!]?.division === "FPO");
  const mpoStartersList = mpo.slice(0, mpoSlots);
  const fpoStartersList = fpo.slice(0, fpoSlots);
  const bench = [
    ...mpo.slice(mpoSlots),
    ...fpo.slice(fpoSlots),
  ].sort((a, b) => a.pickNumber - b.pickNumber);
  const filledStarters = mpoStartersList.length + fpoStartersList.length;
  const totalSlots = mpoSlots + fpoSlots;
  const benchCapacity = Math.max(0, rosterSize - totalSlots);
  const emptyBenchCount = Math.max(0, benchCapacity - bench.length);

  return (
    <div className="px-3 lg:px-6 py-2 space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Starters</span>
        <span className="text-gray-400 text-xs">{filledStarters}/{totalSlots}</span>
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: mpoSlots }).map((_, i) => (
          <MockLineupRow
            key={`mpo-${i}`}
            division="MPO"
            slotIndex={i + 1}
            pick={mpoStartersList[i] ?? null}
            playerById={playerById}
          />
        ))}
        {Array.from({ length: fpoSlots }).map((_, i) => (
          <MockLineupRow
            key={`fpo-${i}`}
            division="FPO"
            slotIndex={i + 1}
            pick={fpoStartersList[i] ?? null}
            playerById={playerById}
          />
        ))}
      </div>
      {benchCapacity > 0 && (
        <>
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Bench</span>
            <span className="text-gray-400 text-xs">{bench.length}/{benchCapacity}</span>
          </div>
          <div className="space-y-1.5">
            {bench.map((p) => {
              const div = playerById[p.playerId!]?.division ?? "MPO";
              return (
                <MockLineupRow
                  key={p.pickNumber}
                  division={div === "MPO" ? "MPO" : "FPO"}
                  pick={p}
                  playerById={playerById}
                  bench
                />
              );
            })}
            {Array.from({ length: emptyBenchCount }).map((_, i) => (
              <MockBenchEmptyRow key={`bench-empty-${i}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MockBenchEmptyRow() {
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-xl border border-dashed"
      style={{ background: "rgba(15,17,23,0.5)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <span className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg text-gray-400 bg-white/5">
        —
      </span>
      <span className="flex-1 text-gray-400 text-sm italic">Empty bench</span>
    </div>
  );
}

function MockLineupRow({
  division,
  slotIndex,
  pick,
  playerById,
  bench = false,
}: {
  division: "MPO" | "FPO";
  slotIndex?: number;
  pick: Pick | null;
  playerById: Record<number, Player>;
  bench?: boolean;
}) {
  const color = division === "MPO" ? "#4B3DFF" : "#36D7B7";
  const bgFilled = division === "MPO" ? "rgba(75,61,255,0.12)" : "rgba(54,215,183,0.10)";
  const borderFilled = division === "MPO" ? "rgba(75,61,255,0.19)" : "rgba(54,215,183,0.16)";
  const player = pick?.playerId != null ? playerById[pick.playerId] : null;
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-xl border"
      style={{
        background: bench ? "rgba(15,17,23,1)" : player ? bgFilled : "rgba(255,255,255,0.02)",
        borderColor: bench ? "rgba(255,255,255,0.05)" : player ? borderFilled : "rgba(255,255,255,0.06)",
      }}
    >
      <span
        className="w-12 shrink-0 text-center text-xs font-bold uppercase tracking-wide py-1 rounded-lg"
        style={{ color, background: `${color}20` }}
      >
        {division}
      </span>
      {player ? (
        <span className="flex-1 text-white text-sm font-medium truncate">{player.name}</span>
      ) : (
        <span className="flex-1 text-gray-400 text-sm italic">Empty</span>
      )}
      <span className="text-gray-400 text-xs font-mono shrink-0">
        {pick ? `#${pick.pickNumber}` : slotIndex ? `Slot ${slotIndex}` : ""}
      </span>
    </div>
  );
}
