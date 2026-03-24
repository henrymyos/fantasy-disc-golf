// @ts-nocheck
"use client";
import { useState, useEffect } from "react";

// =====================
// UI Components
// =====================
const Card = ({ children, className = "" }) => (
  <div className={`border rounded-2xl shadow-md bg-white hover:shadow-lg transition p-4 ${className}`}>
    {children}
  </div>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`text-black ${className}`}>{children}</div>
);

const Button = ({ children, onClick, className = "" }) => (
  <button
    onClick={onClick}
    className={`px-4 py-1 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition transform hover:scale-105 ${className}`}
  >
    {children}
  </button>
);

// =====================
// Google Sheet CSV Link
// =====================
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0cXnJ2EW3nbTb_cPDA4f1Nu8qhjfWPks-j-1UsQpcg3v1nNXEZShaDmAk3a3wjQ/pub?gid=576538322&single=true&output=csv";

// =====================
// Main App
// =====================
export default function FantasyDiscGolfApp() {
  const [leagues, setLeagues] = useState([]);
  const [currentLeagueId, setCurrentLeagueId] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);

  // Load players from Google Sheet
  useEffect(() => {
    fetch(SHEET_URL)
      .then((res) => res.text())
      .then((data) => {
        const rows = data.split("\n").slice(1);
        const parsed = rows
          .map((r) => {
            const [team, name, points] = r.split(",");
            return {
              team: team?.trim(),
              name: name?.trim(),
              points: Number(points || 0),
            };
          })
          .filter((p) => p.name);
        setAllPlayers(parsed);
      })
      .catch(() => {
        const fallback = [
          { team: "Team 1", name: "Calvin Heimburg", points: 48 },
          { team: "Team 1", name: "Paul McBeth", points: 45 },
          { team: "Team 2", name: "Kristin Tattar", points: 40 },
        ];
        setAllPlayers(fallback);
      });
  }, []);

  // Create a new league
  const createLeague = (name) => {
    const newLeague = {
      id: Date.now(),
      name,
      teams: [
        { name: "Henry", roster: [], starters: [], score: 0 },
        { name: "Paige", roster: [], starters: [], score: 0 },
        { name: "Ethan", roster: [], starters: [], score: 0 },
        { name: "Isaac", roster: [], starters: [], score: 0 },
        { name: "Dad", roster: [], starters: [], score: 0 },
        { name: "Mom", roster: [], starters: [], score: 0 },
      ],
      freeAgents: allPlayers,
      // For demo, weekly matchups is a list of arrays: [[teamA, teamB], ...]
      weeklyMatchups: [
        ["Henry", "Paige"],
        ["Ethan", "Isaac"],
        ["Dad", "Mom"],
      ],
    };
    setLeagues([...leagues, newLeague]);
    setCurrentLeagueId(newLeague.id);
  };

  const currentLeague = leagues.find((l) => l.id === currentLeagueId);

  if (!currentLeague) {
    // Multi-league dashboard
    return (
      <MultiLeagueDashboard
        leagues={leagues}
        setCurrentLeagueId={setCurrentLeagueId}
        createLeague={createLeague}
      />
    );
  }

  // League-specific view
  return <LeagueView league={currentLeague} leagues={leagues} setLeagues={setLeagues} />;
}

// =====================
// Multi-League Dashboard
// =====================
function MultiLeagueDashboard({ leagues, setCurrentLeagueId, createLeague }) {
  return (
    <div className="grid gap-4">
      <h2 className="font-bold text-2xl text-black mb-2">Your Leagues</h2>

      {leagues.map((league) => (
        <Card key={league.id}>
          <CardContent className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">{league.name}</span>
            <Button onClick={() => setCurrentLeagueId(league.id)}>Enter</Button>
          </CardContent>
        </Card>
      ))}

      <Button
        className="mt-4"
        onClick={() => {
          const name = prompt("Enter new league name:");
          if (name) createLeague(name);
        }}
      >
        + Start New League
      </Button>
    </div>
  );
}

// =====================
// League View
// =====================
function LeagueView({ league, leagues, setLeagues }) {
  const [page, setPage] = useState("dashboard");

  const updateLeague = (updatedLeague) => {
    const updatedLeagues = leagues.map((l) => (l.id === updatedLeague.id ? updatedLeague : l));
    setLeagues(updatedLeagues);
  };

  const renderLeaguePage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardLeague league={league} />;
      case "matchups":
        return <Matchups league={league} />;
      case "lineups":
        return (
          <Lineups
            teams={league.teams}
            setTeams={(teams) => updateLeague({ ...league, teams })}
          />
        );
      case "freeagency":
        return (
          <FreeAgency
            teams={league.teams}
            setTeams={(teams) => updateLeague({ ...league, teams })}
            freeAgents={league.freeAgents}
            setFreeAgents={(fa) => updateLeague({ ...league, freeAgents: fa })}
          />
        );
      default:
        return <DashboardLeague league={league} />;
    }
  };

  return (
    <div>
      <nav className="flex justify-around bg-gray-200 p-2 rounded-full mb-4">
        {["Dashboard","Matchups","Lineups","Free Agency"].map((p) => (
          <button
            key={p}
            className={`px-4 py-2 rounded-full font-semibold transition ${
              page === p.toLowerCase().replace(" ","") ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-300"
            }`}
            onClick={() => setPage(p.toLowerCase().replace(" ",""))}
          >
            {p}
          </button>
        ))}
      </nav>
      {renderLeaguePage()}
    </div>
  );
}

// =====================
// League Dashboard - with Standings
// =====================
function DashboardLeague({ league }) {
  const sortedTeams = [...league.teams].sort((a, b) => b.score - a.score);
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* Standings */}
      <Card className="md:col-span-1">
        <CardContent>
          <h2 className="font-bold text-lg">Standings</h2>
          {sortedTeams.map((t, i) => (
            <div key={t.name} className="flex justify-between mt-2">
              <span className="font-semibold text-gray-900">{i + 1}. {t.name}</span>
              <span className="text-gray-700">{t.score}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Other dashboard cards */}
      <Card>
        <CardContent>
          <h2 className="font-bold text-lg">Top Team</h2>
          <p>{sortedTeams[0]?.name}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="font-bold text-lg">Status</h2>
          <p>Live</p>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================
// Matchups Tab (was Teams)
// =====================
function Matchups({ league }) {
  return (
    <div className="grid gap-4">
      <h2 className="font-bold text-lg text-black mb-2">This Week's Matchups</h2>
      {league.weeklyMatchups.map(([teamA, teamB], idx) => (
        <Card key={idx}>
          <CardContent className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">{teamA}</span>
            <span className="text-gray-700">vs</span>
            <span className="font-semibold text-gray-900">{teamB}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =====================
// Lineups Tab
// =====================
function Lineups({ teams, setTeams }) {
  const toggleStarter = (ti, player) => {
    const t = [...teams];
    const starters = t[ti].starters;
    const exists = starters.find((p) => p.name === player.name);
    t[ti].starters = exists ? starters.filter((p) => p.name !== player.name) : [...starters, player];
    setTeams(t);
  };

  return (
    <div className="grid gap-4">
      {teams.map((t, i) => (
        <Card key={t.name}>
          <CardContent>
            <h2 className="font-bold text-lg">{t.name} Lineup</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {t.roster.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <Button onClick={() => toggleStarter(i, p)}>Toggle</Button>
                  <span className="text-gray-900">{p.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =====================
// Free Agency Tab
// =====================
function FreeAgency({ teams, setTeams, freeAgents, setFreeAgents }) {
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(teams.length > 0 ? 0 : -1);

  const addPlayer = (teamIndex, player) => {
    if (teamIndex < 0 || teamIndex >= teams.length) return;
    const updatedTeams = [...teams];
    updatedTeams[teamIndex].roster.push(player);
    setTeams(updatedTeams);
    setFreeAgents(freeAgents.filter((x) => x.name !== player.name));
  };

  return (
    <div className="grid gap-3">
      {freeAgents.map((p) => (
        <Card key={p.name}>
          <CardContent className="flex items-center gap-2">
            <select
              className="rounded-full border px-2 py-1 text-gray-700"
              value={selectedTeamIndex}
              onChange={(e) => setSelectedTeamIndex(Number(e.target.value))}
            >
              {teams.map((t, i) => (
                <option key={i} value={i}>{t.name}</option>
              ))}
            </select>

            <Button onClick={() => addPlayer(selectedTeamIndex, p)}>Add</Button>
            <span className="text-gray-900">{p.name}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}