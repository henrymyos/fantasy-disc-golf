"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { proposeTrade, respondToTrade, cancelTrade } from "@/actions/trades";

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
  const [tradingWith, setTradingWith] = useState<Team | null>(null);
  const [offerIds, setOfferIds] = useState<Set<number>>(new Set());
  const [requestIds, setRequestIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [submitting, startSubmitTransition] = useTransition();

  useEffect(() => {
    params.then(({ id }) => {
      setLeagueId(Number(id));
      load(Number(id));
    });
  }, []);

  async function load(lid: number) {
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

    setMyTeam(buildTeam(myMember));
    setOtherTeams((members ?? []).filter((m) => m.id !== myMember.id).map(buildTeam));

    const { data: tradeData } = await supabase
      .from("trades")
      .select(`
        id, status, message, proposed_at,
        proposer:league_members!trades_proposer_id_fkey(id, team_name),
        receiver:league_members!trades_receiver_id_fkey(id, team_name),
        trade_players(player_id, from_team_id, to_team_id, players(name, division))
      `)
      .eq("league_id", lid)
      .eq("status", "pending")
      .order("proposed_at", { ascending: false });
    setPendingTrades(tradeData ?? []);
    setLoading(false);
  }

  function toggleOffer(id: number) {
    setOfferIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleRequest(id: number) {
    setRequestIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function goToTeam(team: Team) {
    setTradingWith(team);
    setOfferIds(new Set());
    setRequestIds(new Set());
    setMessage("");
    setStep("players");
  }

  function handleSend() {
    if (!leagueId || !tradingWith || offerIds.size === 0 || requestIds.size === 0) return;
    startSubmitTransition(async () => {
      await proposeTrade(leagueId, tradingWith.id, [...offerIds], [...requestIds], message);
      setStep("teams");
      setTradingWith(null);
      setOfferIds(new Set());
      setRequestIds(new Set());
      setMessage("");
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

  // ── Step: teams ──────────────────────────────────────────────────
  if (step === "teams") {
    return (
      <div className="max-w-2xl space-y-6">
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
          </div>
          {otherTeams.length === 0 ? (
            <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
              <p className="text-gray-600 text-sm">No other teams in this league yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {otherTeams.map((team) => (
                <div
                  key={team.id}
                  className="w-full bg-[#1a1d23] hover:bg-[#23262e] border border-white/5 hover:border-white/10 rounded-2xl p-4 transition"
                >
                  <button
                    type="button"
                    onClick={() => goToTeam(team)}
                    className="w-full flex items-center justify-between mb-3 text-left"
                  >
                    <p className="text-white font-semibold">{team.teamName}</p>
                    <span className="text-gray-500 text-xs">{team.roster.length} players →</span>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {team.roster.slice(0, 7).map((p) => {
                      const isMpo = p.division === "MPO";
                      return (
                        <Link
                          key={p.id}
                          href={`/league/${leagueId}/player/${p.id}`}
                          className="text-xs px-2 py-0.5 rounded-md font-medium hover:underline"
                          style={{
                            background: isMpo ? "rgba(75,61,255,0.18)" : "rgba(54,215,183,0.15)",
                            color: isMpo ? "#a09aff" : "#36D7B7",
                          }}
                        >
                          {p.name.split(" ").pop()}
                        </Link>
                      );
                    })}
                    {team.roster.length > 7 && (
                      <span className="text-xs text-gray-600">+{team.roster.length - 7}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!myTeam || !tradingWith) return null;

  // ── Step: players ────────────────────────────────────────────────
  if (step === "players") {
    const canView = offerIds.size > 0 && requestIds.size > 0;

    return (
      <div className="max-w-2xl pb-24">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => setStep("teams")} className="text-gray-400 hover:text-white text-sm transition">
            ← Back
          </button>
          <h2 className="text-white font-bold">Propose a Trade</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* My column */}
          <div>
            <p className="text-white font-semibold text-sm mb-3 truncate">{myTeam.teamName}</p>
            <div className="space-y-2">
              {myTeam.roster.map((p) => (
                <PlayerCard key={p.id} leagueId={leagueId ?? 0} player={p} selected={offerIds.has(p.id)} onToggle={() => toggleOffer(p.id)} />
              ))}
              {myTeam.roster.length === 0 && (
                <p className="text-gray-600 text-xs">No players on roster</p>
              )}
            </div>
          </div>

          {/* Their column */}
          <div>
            <p className="text-white font-semibold text-sm mb-3 truncate">{tradingWith.teamName}</p>
            <div className="space-y-2">
              {tradingWith.roster.map((p) => (
                <PlayerCard key={p.id} leagueId={leagueId ?? 0} player={p} selected={requestIds.has(p.id)} onToggle={() => toggleRequest(p.id)} />
              ))}
              {tradingWith.roster.length === 0 && (
                <p className="text-gray-600 text-xs">No players on roster</p>
              )}
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="fixed bottom-0 left-0 md:left-14 lg:left-56 right-0 z-40 bg-[#0f1117]/95 backdrop-blur-sm border-t border-white/5 px-4 lg:px-6 py-4">
          <div className="max-w-2xl flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-sm">Trade Proposal</p>
              {(offerIds.size > 0 || requestIds.size > 0) && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {offerIds.size} offering · {requestIds.size} requesting
                </p>
              )}
            </div>
            <button
              onClick={() => setStep("review")}
              disabled={!canView}
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
  const iOffer = myTeam.roster.filter((p) => offerIds.has(p.id));
  const iRequest = tradingWith.roster.filter((p) => requestIds.has(p.id));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setStep("players")} className="text-gray-400 hover:text-white text-sm transition">
          ← Back
        </button>
        <h2 className="text-white font-bold">Trade Proposal</h2>
        <span className="bg-[#36D7B7] text-black text-xs font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0">
          {offerIds.size + requestIds.size}
        </span>
      </div>

      {/* My team */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <p className="text-white font-semibold mb-4">{myTeam.teamName}</p>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-5">
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Receives</p>
            <div className="space-y-3">
              {iRequest.map((p) => <ReviewPlayer key={p.id} leagueId={leagueId ?? 0} player={p} />)}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Sends</p>
            <div className="space-y-3">
              {iOffer.map((p) => <ReviewPlayer key={p.id} leagueId={leagueId ?? 0} player={p} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Their team */}
      <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
        <p className="text-white font-semibold mb-4">{tradingWith.teamName}</p>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-5">
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Receives</p>
            <div className="space-y-3">
              {iOffer.map((p) => <ReviewPlayer key={p.id} leagueId={leagueId ?? 0} player={p} />)}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-3">Sends</p>
            <div className="space-y-3">
              {iRequest.map((p) => <ReviewPlayer key={p.id} leagueId={leagueId ?? 0} player={p} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Message */}
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

function PlayerCard({ leagueId, player, selected, onToggle }: { leagueId: number; player: Player; selected: boolean; onToggle: () => void }) {
  const isMpo = player.division === "MPO";
  const accent = isMpo ? "#4B3DFF" : "#36D7B7";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className={`w-full text-left rounded-xl overflow-hidden border transition cursor-pointer ${
        selected
          ? "border-[#36D7B7]/50 ring-1 ring-[#36D7B7]/20"
          : "border-white/5 hover:border-white/15"
      }`}
    >
      {/* Colored header band */}
      <div
        className="px-3 py-1.5 flex items-center justify-between"
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
      {/* Player info */}
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
      </div>
    </div>
  );
}

function ReviewPlayer({ leagueId, player }: { leagueId: number; player: Player }) {
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
  const isReceiver = trade.receiver?.id === myTeamId;
  const isProposer = trade.proposer?.id === myTeamId;
  const toMe = (trade.trade_players ?? []).filter((tp: any) => tp.to_team_id === myTeamId);
  const fromMe = (trade.trade_players ?? []).filter((tp: any) => tp.from_team_id === myTeamId);

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-[#4B3DFF]/25">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white text-sm font-medium">
            {trade.proposer?.team_name} → {trade.receiver?.team_name}
          </p>
          {trade.message && <p className="text-gray-500 text-xs mt-0.5">"{trade.message}"</p>}
        </div>
        <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full shrink-0 ml-3">Pending</span>
      </div>

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
        </div>
      </div>

      <div className="flex gap-2">
        {isReceiver && (
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
