"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { proposeTrade, respondToTrade, cancelTrade } from "@/actions/trades";

export default function TradesPage({ params }: { params: Promise<{ id: string }> }) {
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [myTeam, setMyTeam] = useState<any>(null);
  const [myRoster, setMyRoster] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  const [theirRoster, setTheirRoster] = useState<any[]>([]);
  const [offerIds, setOfferIds] = useState<number[]>([]);
  const [requestIds, setRequestIds] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

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

    const [{ data: members }, { data: myMember }] = await Promise.all([
      supabase.from("league_members").select("id, team_name, user_id").eq("league_id", lid),
      supabase.from("league_members").select("id, team_name").eq("league_id", lid).eq("user_id", user.id).single(),
    ]);

    setMyTeam(myMember);
    setTeams((members ?? []).filter((m) => m.id !== myMember?.id));

    const { data: roster } = await supabase
      .from("rosters")
      .select("player_id, players(id, name, division)")
      .eq("league_id", lid)
      .eq("team_id", myMember?.id ?? 0);

    setMyRoster(roster ?? []);

    const { data: tradeData } = await supabase
      .from("trades")
      .select(`
        id, status, message, proposed_at,
        proposer:league_members!trades_proposer_id_fkey(id, team_name),
        receiver:league_members!trades_receiver_id_fkey(id, team_name),
        trade_players(player_id, from_team_id, to_team_id, players(name))
      `)
      .eq("league_id", lid)
      .in("status", ["pending"])
      .order("proposed_at", { ascending: false });

    setTrades(tradeData ?? []);
    setLoading(false);
  }

  async function loadTheirRoster(teamId: number) {
    if (!leagueId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("rosters")
      .select("player_id, players(id, name, division)")
      .eq("league_id", leagueId)
      .eq("team_id", teamId);
    setTheirRoster(data ?? []);
  }

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold">Trades</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          {showForm ? "Cancel" : "Propose Trade"}
        </button>
      </div>

      {/* Trade form */}
      {showForm && (
        <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5 space-y-4">
          <h3 className="font-semibold text-white">New Trade Proposal</h3>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Trade with</label>
            <select
              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#4B3DFF]"
              value={selectedTeam ?? ""}
              onChange={(e) => {
                const tid = Number(e.target.value);
                setSelectedTeam(tid);
                setOfferIds([]);
                setRequestIds([]);
                loadTheirRoster(tid);
              }}
            >
              <option value="">Select a team...</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
            </select>
          </div>

          {selectedTeam && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-2">You offer:</p>
                <div className="space-y-1">
                  {myRoster.map((spot) => (
                    <label key={spot.player_id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={offerIds.includes(spot.player_id)}
                        onChange={(e) => setOfferIds(e.target.checked
                          ? [...offerIds, spot.player_id]
                          : offerIds.filter((id) => id !== spot.player_id)
                        )}
                        className="rounded accent-[#4B3DFF]"
                      />
                      <span className="text-sm text-white">{spot.players?.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-2">You want:</p>
                <div className="space-y-1">
                  {theirRoster.map((spot) => (
                    <label key={spot.player_id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requestIds.includes(spot.player_id)}
                        onChange={(e) => setRequestIds(e.target.checked
                          ? [...requestIds, spot.player_id]
                          : requestIds.filter((id) => id !== spot.player_id)
                        )}
                        className="rounded accent-[#4B3DFF]"
                      />
                      <span className="text-sm text-white">{spot.players?.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Message (optional)</label>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#4B3DFF]"
              placeholder="Let's make a deal..."
            />
          </div>

          <button
            onClick={async () => {
              if (!leagueId || !selectedTeam || offerIds.length === 0 || requestIds.length === 0) return;
              await proposeTrade(leagueId, selectedTeam, offerIds, requestIds, message);
              setShowForm(false);
              if (leagueId) load(leagueId);
            }}
            className="w-full bg-[#4B3DFF] hover:bg-[#3a2ee0] text-white font-semibold py-2.5 rounded-lg transition"
          >
            Send Trade Proposal
          </button>
        </div>
      )}

      {/* Pending trades */}
      {trades.length === 0 ? (
        <div className="bg-[#1a1d23] rounded-2xl p-12 border border-white/5 text-center">
          <p className="text-gray-600 text-sm">No pending trades</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => {
            const isProposer = trade.proposer?.id === myTeam?.id;
            const isReceiver = trade.receiver?.id === myTeam?.id;
            const toMe = trade.trade_players?.filter((tp: any) => tp.to_team_id === myTeam?.id);
            const fromMe = trade.trade_players?.filter((tp: any) => tp.from_team_id === myTeam?.id);

            return (
              <div key={trade.id} className="bg-[#1a1d23] rounded-2xl p-5 border border-[#4B3DFF]/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white text-sm font-medium">
                      {trade.proposer?.team_name} → {trade.receiver?.team_name}
                    </p>
                    {trade.message && <p className="text-gray-500 text-xs mt-0.5">"{trade.message}"</p>}
                  </div>
                  <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">Pending</span>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs text-gray-400 mb-4">
                  <div>
                    <p className="font-medium text-gray-300 mb-1">You receive:</p>
                    {(toMe ?? []).map((tp: any) => <p key={tp.player_id}>{tp.players?.name}</p>)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-300 mb-1">You give up:</p>
                    {(fromMe ?? []).map((tp: any) => <p key={tp.player_id}>{tp.players?.name}</p>)}
                  </div>
                </div>

                <div className="flex gap-2">
                  {isReceiver && (
                    <>
                      <form action={respondToTrade.bind(null, trade.id, true)}>
                        <button type="submit" className="text-xs bg-[#36D7B7] hover:bg-[#2bc4a6] text-black font-semibold px-4 py-1.5 rounded-full transition">
                          Accept
                        </button>
                      </form>
                      <form action={respondToTrade.bind(null, trade.id, false)}>
                        <button type="submit" className="text-xs border border-red-400/30 text-red-400 hover:border-red-400/60 px-4 py-1.5 rounded-full transition">
                          Reject
                        </button>
                      </form>
                    </>
                  )}
                  {isProposer && (
                    <form action={cancelTrade.bind(null, trade.id)}>
                      <button type="submit" className="text-xs border border-white/10 text-gray-400 hover:text-white px-4 py-1.5 rounded-full transition">
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
