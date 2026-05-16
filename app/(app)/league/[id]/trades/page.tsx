"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { proposeTrade, respondToTrade, cancelTrade, type TradeMovement } from "@/actions/trades";

type Player = { id: number; name: string; division: string; worldRanking: number | null };
type Team = { id: number; teamName: string; roster: Player[] };
type Step = "teams" | "players" | "review";

export default function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [otherTeams, setOtherTeams] = useState<Team[]>([]);
  const [pendingTrades, setPendingTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("teams");
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [movements, setMovements] = useState<TradeMovement[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, startSubmitTransition] = useTransition();

  useEffect(() => {
    params.then(({ id }) => {
      setLeagueId(Number(id));
      load(Number(id), true);
    });
  }, []);

  async function load(lid: number, applyPrefill = false) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: myMember } = await supabase
      .from("league_members")
      .select("id, team_name")
      .eq("league_id", lid)
      .eq("user_id", user.id)
      .single();
    if (!myMember) return;

    const { data: members } = await supabase
      .from("league_members")
      .select("id, team_name")
      .eq("league_id", lid);

    const { data: allRosters } = await supabase
      .from("rosters")
      .select("team_id, player_id, players(id, name, division, world_ranking)")
      .eq("league_id", lid);

    function buildTeam(m: { id: number; team_name: string }): Team {
      const spots = (allRosters ?? []).filter((r) => r.team_id === m.id);
      const roster: Player[] = spots
        .map((s: any) => ({
          id: s.players.id,
          name: s.players.name,
          division: s.players.division,
          worldRanking: s.players.world_ranking,
        }))
        .sort((a, b) => {
          if (a.division !== b.division) return a.division === "MPO" ? -1 : 1;
          return (a.worldRanking ?? 9999) - (b.worldRanking ?? 9999);
        });
      return { id: m.id, teamName: m.team_name, roster };
    }

    const me = buildTeam(myMember);
    setMyTeam(me);
    const others = (members ?? []).filter((m) => m.id !== myMember.id).map(buildTeam);
    setOtherTeams(others);

    if (applyPrefill) {
      const sp = new URLSearchParams(window.location.search);
      const withParam = sp.get("with");
      const wantParam = sp.get("want");
      if (withParam && wantParam) {
        const targetTeam = others.find((t) => t.id === Number(withParam));
        const wantId = Number(wantParam);
        if (targetTeam && targetTeam.roster.some((p) => p.id === wantId)) {
          setSelectedTeamIds(new Set([targetTeam.id]));
          setMovements([{ playerId: wantId, fromTeamId: targetTeam.id, toTeamId: me.id }]);
          setMessage("");
          setStep("players");
        }
        window.history.replaceState(null, "", window.location.pathname);
      }
    }

    const { data: tradeData } = await supabase
      .from("trades")
      .select(`
        id, status, message, proposed_at,
        proposer:league_members!trades_proposer_id_fkey(id, team_name),
        trade_players(player_id, from_team_id, to_team_id, players(name, division)),
        trade_participants(team_id, status, league_members!inner(team_name))
      `)
      .eq("league_id", lid)
      .eq("status", "pending")
      .order("proposed_at", { ascending: false });
    setPendingTrades(tradeData ?? []);
    setLoading(false);
  }

  function toggleTeam(teamId: number) {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  function startProposal() {
    if (selectedTeamIds.size === 0) return;
    setMovements([]);
    setMessage("");
    setStep("players");
  }

  function isInMovements(playerId: number) {
    return movements.some((m) => m.playerId === playerId);
  }

  function togglePlayer(playerId: number, fromTeamId: number) {
    setMovements((prev) => {
      const existing = prev.find((m) => m.playerId === playerId);
      if (existing) return prev.filter((m) => m.playerId !== playerId);
      // Default destination: if from me, send to first selected team; else send to me
      const defaultTo =
        fromTeamId === myTeam?.id
          ? [...selectedTeamIds][0]
          : myTeam?.id;
      if (defaultTo == null) return prev;
      return [...prev, { playerId, fromTeamId, toTeamId: defaultTo }];
    });
  }

  function setDestination(playerId: number, toTeamId: number) {
    setMovements((prev) =>
      prev.map((m) => (m.playerId === playerId ? { ...m, toTeamId } : m)),
    );
  }

  function handleSend() {
    if (!leagueId || selectedTeamIds.size === 0 || movements.length === 0) return;
    startSubmitTransition(async () => {
      await proposeTrade(leagueId, [...selectedTeamIds], movements, message);
      setSelectedTeamIds(new Set());
      setMovements([]);
      setMessage("");
      setStep("teams");
      load(leagueId);
    });
  }

  async function handleRespond(tradeId: number, accept: boolean) {
    await respondToTrade(tradeId, accept);
    if (leagueId) load(leagueId);
  }

  async function handleCancel(tradeId: number) {
    await cancelTrade(tradeId);
    if (leagueId) load(leagueId);
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>;

  const involvedTeams: Team[] = myTeam
    ? [myTeam, ...otherTeams.filter((t) => selectedTeamIds.has(t.id))]
    : [];
  const allowedDestIds = new Set(involvedTeams.map((t) => t.id));
  const filteredMovements = movements.filter((m) => allowedDestIds.has(m.toTeamId));

  // ── Step: teams ──────────────────────────────────────────────────
  if (step === "teams") {
    const selectionCount = selectedTeamIds.size;
    return (
      <div className="max-w-3xl space-y-6 pb-24">
        {pendingTrades.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-white font-bold">Pending Trades</h2>
            {pendingTrades.map((trade) => (
              <PendingTradeCard
                key={trade.id}
                leagueId={leagueId ?? 0}
                trade={trade}
                myTeamId={myTeam?.id ?? 0}
                onRespond={handleRespond}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}

        <div>
          <div className="flex items-center gap-3 mb-4">
            {leagueId && (
              <Link href={`/league/${leagueId}/lineups`} className="text-gray-400 hover:text-white text-sm transition">
                ← Back
              </Link>
            )}
            <h2 className="text-white font-bold">Propose a Trade</h2>
            <span className="text-gray-500 text-xs">Tap teams to include</span>
          </div>

          {otherTeams.length === 0 ? (
            <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
              <p className="text-gray-600 text-sm">No other teams in this league yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {otherTeams.map((team) => {
                const selected = selectedTeamIds.has(team.id);
                return (
                  <div
                    key={team.id}
                    className={`rounded-2xl p-3 border transition ${
                      selected
                        ? "bg-[#36D7B7]/5 border-[#36D7B7]/40 ring-1 ring-[#36D7B7]/20"
                        : "bg-[#0f1117] border-white/5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleTeam(team.id)}
                      className="w-full text-left mb-3 hover:opacity-90 transition flex items-start gap-2"
                    >
                      <div
                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition"
                        style={
                          selected
                            ? { borderColor: "#36D7B7", background: "#36D7B7" }
                            : { borderColor: "rgba(255,255,255,0.25)", background: "transparent" }
                        }
                      >
                        {selected && (
                          <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm truncate">{team.teamName}</p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {team.roster.length} player{team.roster.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </button>
                    <div className="space-y-2">
                      {team.roster.map((p) => (
                        <TeamRosterCard key={p.id} leagueId={leagueId ?? 0} player={p} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectionCount > 0 && (
          <div className="fixed bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 px-4 lg:px-6 py-4">
            <div className="max-w-3xl flex items-center justify-between">
              <div>
                <p className="text-white font-semibold text-sm">
                  {selectionCount} team{selectionCount !== 1 ? "s" : ""} selected
                </p>
                <p className="text-gray-500 text-xs mt-0.5">All teams must accept the proposal.</p>
              </div>
              <button
                onClick={startProposal}
                className="bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-bold px-7 py-2.5 rounded-full text-sm tracking-wide transition"
              >
                START TRADE PROPOSAL
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!myTeam) return null;

  // ── Step: players ────────────────────────────────────────────────
  if (step === "players") {
    const canReview = filteredMovements.length > 0;

    return (
      <div className="max-w-5xl pb-24">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => setStep("teams")} className="text-gray-400 hover:text-white text-sm transition">
            ← Back
          </button>
          <h2 className="text-white font-bold">Build the trade</h2>
          <span className="text-gray-500 text-xs">Tap players to include them</span>
        </div>

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${involvedTeams.length}, minmax(0, 1fr))` }}
        >
          {involvedTeams.map((team) => {
            const isMine = team.id === myTeam.id;
            return (
              <div
                key={team.id}
                className={`rounded-2xl p-3 border ${
                  isMine ? "bg-[#4B3DFF]/5 border-[#4B3DFF]/30" : "bg-[#0f1117] border-white/5"
                }`}
              >
                <div className="mb-3 px-1">
                  <p className="text-white font-semibold text-sm truncate">
                    {isMine ? `${team.teamName} (you)` : team.teamName}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {team.roster.length} player{team.roster.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="space-y-2">
                  {team.roster.map((p) => {
                    const mv = movements.find((m) => m.playerId === p.id);
                    return (
                      <SelectablePlayerCard
                        key={p.id}
                        leagueId={leagueId ?? 0}
                        player={p}
                        selected={!!mv}
                        onToggle={() => togglePlayer(p.id, team.id)}
                        movement={mv}
                        involvedTeams={involvedTeams}
                        onChangeDestination={(toId) => setDestination(p.id, toId)}
                        fromTeamId={team.id}
                        showDestinationPicker={involvedTeams.length > 2}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="fixed bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 px-4 lg:px-6 py-4">
          <div className="max-w-5xl flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-sm">Trade Proposal</p>
              {filteredMovements.length > 0 && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {filteredMovements.length} player{filteredMovements.length !== 1 ? "s" : ""} moving
                </p>
              )}
            </div>
            <button
              onClick={() => setStep("review")}
              disabled={!canReview}
              className="bg-[#36D7B7] hover:bg-[#2bc4a6] disabled:opacity-30 text-black font-bold px-7 py-2.5 rounded-full text-sm tracking-wide transition"
            >
              VIEW PROPOSAL
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: review ─────────────────────────────────────────────────
  const teamById = new Map<number, Team>();
  for (const t of involvedTeams) teamById.set(t.id, t);
  const playerById = new Map<number, Player>();
  for (const t of involvedTeams) for (const p of t.roster) playerById.set(p.id, p);

  // Group movements per receiving team for review summary
  const receivedByTeam = new Map<number, TradeMovement[]>();
  const sentByTeam = new Map<number, TradeMovement[]>();
  for (const m of filteredMovements) {
    if (!receivedByTeam.has(m.toTeamId)) receivedByTeam.set(m.toTeamId, []);
    receivedByTeam.get(m.toTeamId)!.push(m);
    if (!sentByTeam.has(m.fromTeamId)) sentByTeam.set(m.fromTeamId, []);
    sentByTeam.get(m.fromTeamId)!.push(m);
  }

  return (
    <div className="max-w-3xl space-y-4 pb-12">
      <div className="flex items-center gap-3">
        <button onClick={() => setStep("players")} className="text-gray-400 hover:text-white text-sm transition">
          ← Back
        </button>
        <h2 className="text-white font-bold">Trade Proposal</h2>
        <span className="bg-[#36D7B7] text-black text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0">
          {filteredMovements.length}
        </span>
      </div>

      <div className="space-y-3">
        {involvedTeams.map((team) => {
          const received = receivedByTeam.get(team.id) ?? [];
          const sent = sentByTeam.get(team.id) ?? [];
          if (received.length === 0 && sent.length === 0) return null;
          return (
            <div key={team.id} className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
              <p className="text-white font-semibold mb-4">{team.teamName}</p>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Receives</p>
                  <div className="space-y-3">
                    {received.map((m) => {
                      const p = playerById.get(m.playerId);
                      const from = teamById.get(m.fromTeamId);
                      return p ? (
                        <ReviewPlayer
                          key={m.playerId}
                          leagueId={leagueId ?? 0}
                          player={p}
                          note={from ? `from ${from.teamName}` : undefined}
                        />
                      ) : null;
                    })}
                    {received.length === 0 && <p className="text-gray-600 text-xs">—</p>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Sends</p>
                  <div className="space-y-3">
                    {sent.map((m) => {
                      const p = playerById.get(m.playerId);
                      const to = teamById.get(m.toTeamId);
                      return p ? (
                        <ReviewPlayer
                          key={m.playerId}
                          leagueId={leagueId ?? 0}
                          player={p}
                          note={to ? `to ${to.teamName}` : undefined}
                        />
                      ) : null;
                    })}
                    {sent.length === 0 && <p className="text-gray-600 text-xs">—</p>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Add a message (optional)"
        className="w-full bg-[#1a1d23] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF] text-sm"
      />

      <button
        onClick={handleSend}
        disabled={submitting}
        className="w-full bg-[#36D7B7] hover:bg-[#2bc4a6] disabled:opacity-40 text-black font-black py-4 rounded-2xl text-sm tracking-widest transition"
      >
        {submitting ? "Sending..." : "SEND TRADE PROPOSAL"}
      </button>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function TeamRosterCard({ leagueId, player }: { leagueId: number; player: Player }) {
  const isMpo = player.division === "MPO";
  const accent = isMpo ? "#4B3DFF" : "#36D7B7";
  return (
    <div className="rounded-xl overflow-hidden border border-white/5">
      <div
        className="px-3 py-1.5 flex items-center"
        style={{ background: `${accent}28` }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {player.division}
        </span>
      </div>
      <div className="bg-[#1a1d23] px-3 py-2">
        <Link
          href={`/league/${leagueId}/player/${player.id}`}
          className="text-white font-semibold text-sm leading-tight truncate hover:underline block"
        >
          {player.name}
        </Link>
        {player.worldRanking != null && (
          <p className="text-gray-600 text-xs mt-0.5">#{player.worldRanking}</p>
        )}
      </div>
    </div>
  );
}

function SelectablePlayerCard({
  leagueId,
  player,
  selected,
  onToggle,
  movement,
  involvedTeams,
  fromTeamId,
  onChangeDestination,
  showDestinationPicker,
}: {
  leagueId: number;
  player: Player;
  selected: boolean;
  onToggle: () => void;
  movement: TradeMovement | undefined;
  involvedTeams: Team[];
  fromTeamId: number;
  onChangeDestination: (toTeamId: number) => void;
  showDestinationPicker: boolean;
}) {
  const isMpo = player.division === "MPO";
  const accent = isMpo ? "#4B3DFF" : "#36D7B7";
  const destOptions = involvedTeams.filter((t) => t.id !== fromTeamId);
  const destTeam = movement ? involvedTeams.find((t) => t.id === movement.toTeamId) : null;

  return (
    <div
      className={`rounded-xl overflow-hidden border transition ${
        selected ? "border-[#36D7B7]/50 ring-1 ring-[#36D7B7]/20" : "border-white/5 hover:border-white/15"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="px-3 py-1.5 flex items-center justify-between cursor-pointer"
        style={{ background: `${accent}28` }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {player.division}
        </span>
        <div
          className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition"
          style={
            selected
              ? { borderColor: "#36D7B7", background: "#36D7B7" }
              : { borderColor: "rgba(255,255,255,0.25)", background: "transparent" }
          }
        >
          {selected && (
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
      <div className="bg-[#1a1d23] px-3 py-2">
        <Link
          href={`/league/${leagueId}/player/${player.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-white font-semibold text-sm leading-tight truncate hover:underline block"
        >
          {player.name}
        </Link>
        {player.worldRanking != null && (
          <p className="text-gray-600 text-xs mt-0.5">#{player.worldRanking}</p>
        )}
        {selected && showDestinationPicker && destOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">to</span>
            {destOptions.map((t) => {
              const isDest = destTeam?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onChangeDestination(t.id); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition ${
                    isDest
                      ? "bg-[#36D7B7] text-black"
                      : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {t.teamName}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewPlayer({ leagueId, player, note }: { leagueId: number; player: Player; note?: string }) {
  const isMpo = player.division === "MPO";
  const color = isMpo ? "#a09aff" : "#36D7B7";
  return (
    <Link href={`/league/${leagueId}/player/${player.id}`} className="flex items-center gap-2.5 hover:opacity-80 transition">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ background: isMpo ? "rgba(75,61,255,0.25)" : "rgba(54,215,183,0.2)" }}
      >
        {player.name[0]?.toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="text-white text-sm font-medium leading-tight truncate hover:underline">{player.name}</p>
        <p className="text-xs font-semibold" style={{ color }}>{player.division}</p>
        {note && <p className="text-gray-500 text-[10px] mt-0.5">{note}</p>}
      </div>
    </Link>
  );
}

function PendingTradeCard({
  leagueId,
  trade,
  myTeamId,
  onRespond,
  onCancel,
}: {
  leagueId: number;
  trade: any;
  myTeamId: number;
  onRespond: (id: number, accept: boolean) => void;
  onCancel: (id: number) => void;
}) {
  const isProposer = trade.proposer?.id === myTeamId;
  const participants: any[] = trade.trade_participants ?? [];
  const myParticipant = participants.find((p) => p.team_id === myTeamId);
  const iAmReceiver = !!myParticipant;
  const myStatus: string | undefined = myParticipant?.status;

  // Movements I'm involved in (where I receive or give up).
  const toMe = (trade.trade_players ?? []).filter((tp: any) => tp.to_team_id === myTeamId);
  const fromMe = (trade.trade_players ?? []).filter((tp: any) => tp.from_team_id === myTeamId);

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-[#4B3DFF]/25">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white text-sm font-medium">
            {trade.proposer?.team_name} proposed a trade
          </p>
          {trade.message && <p className="text-gray-500 text-xs mt-0.5">&quot;{trade.message}&quot;</p>}
        </div>
        <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full shrink-0 ml-3">Pending</span>
      </div>

      {iAmReceiver && (
        <div className="grid grid-cols-2 gap-4 text-xs mb-4">
          <div>
            <p className="text-gray-500 font-semibold mb-1">You receive</p>
            {toMe.map((tp: any) => (
              <Link
                key={tp.player_id}
                href={`/league/${leagueId}/player/${tp.player_id}`}
                className="block text-white hover:underline"
              >
                {tp.players?.name}
              </Link>
            ))}
            {toMe.length === 0 && <p className="text-gray-600">—</p>}
          </div>
          <div>
            <p className="text-gray-500 font-semibold mb-1">You give up</p>
            {fromMe.map((tp: any) => (
              <Link
                key={tp.player_id}
                href={`/league/${leagueId}/player/${tp.player_id}`}
                className="block text-white hover:underline"
              >
                {tp.players?.name}
              </Link>
            ))}
            {fromMe.length === 0 && <p className="text-gray-600">—</p>}
          </div>
        </div>
      )}

      {participants.length > 0 && (
        <div className="mb-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wide font-semibold mb-1.5">Participants</p>
          <div className="flex flex-wrap gap-1.5">
            {participants.map((p: any) => {
              const colors =
                p.status === "accepted"
                  ? "text-[#36D7B7] bg-[#36D7B7]/10 border-[#36D7B7]/25"
                  : p.status === "rejected"
                  ? "text-red-400 bg-red-400/10 border-red-400/25"
                  : "text-gray-400 bg-white/5 border-white/10";
              return (
                <span
                  key={p.team_id}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${colors}`}
                >
                  {(p.league_members as any)?.team_name ?? "Team"} · {p.status}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {iAmReceiver && myStatus === "pending" && (
          <>
            <button
              onClick={() => onRespond(trade.id, true)}
              className="text-xs bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-semibold px-4 py-1.5 rounded-full transition"
            >
              Accept
            </button>
            <button
              onClick={() => onRespond(trade.id, false)}
              className="text-xs border border-red-400/30 text-red-400 hover:border-red-400/60 px-4 py-1.5 rounded-full transition"
            >
              Reject
            </button>
          </>
        )}
        {isProposer && (
          <button
            onClick={() => onCancel(trade.id)}
            className="text-xs border border-white/10 text-gray-400 hover:text-white px-4 py-1.5 rounded-full transition"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
