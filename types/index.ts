export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
};

export type Player = {
  id: number;
  name: string;
  division: string | null;
  pdga_number: string | null;
  avatar_url: string | null;
};

export type League = {
  id: number;
  name: string;
  commissioner_id: string;
  invite_code: string;
  max_teams: number;
  roster_size: number;
  starters_count: number;
  mpo_starters: number;
  fpo_starters: number;
  season_year: number;
  current_week: number;
  draft_status: "pending" | "in_progress" | "paused" | "complete";
  scoring_type: "placement" | "points";
  created_at: string;
};

export type LeagueMember = {
  id: number;
  league_id: number;
  user_id: string;
  team_name: string;
  is_commissioner: boolean;
  draft_position: number | null;
  joined_at: string;
  profiles?: Profile;
};

export type RosterSpot = {
  id: number;
  league_id: number;
  team_id: number;
  player_id: number;
  is_starter: boolean;
  acquired_week: number;
  players?: Player;
};

export type Tournament = {
  id: number;
  name: string;
  week: number;
  season_year: number;
  start_date: string | null;
  end_date: string | null;
};

export type Matchup = {
  id: number;
  league_id: number;
  week: number;
  team1_id: number;
  team2_id: number;
  team1_score: number;
  team2_score: number;
  is_final: boolean;
  team1?: LeagueMember;
  team2?: LeagueMember;
};

export type Draft = {
  id: number;
  league_id: number;
  status: "pending" | "in_progress" | "complete";
  type: "snake";
  current_pick: number;
  total_rounds: number;
  seconds_per_pick: number;
  started_at: string | null;
};

export type Trade = {
  id: number;
  league_id: number;
  proposer_id: number;
  receiver_id: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  message: string | null;
  proposed_at: string;
  resolved_at: string | null;
  proposer?: LeagueMember;
  receiver?: LeagueMember;
  trade_players?: TradePlayers[];
};

export type TradePlayers = {
  id: number;
  trade_id: number;
  player_id: number;
  from_team_id: number;
  to_team_id: number;
  players?: Player;
};
