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
  const [page, setPage] = useState("dashboard");
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
    };
    setLeagues([...leagues, newLeague]);
    setCurrentLeagueId(newLeague.id);
    setPage("league");
  };

  const currentLeague = leagues.find((l) => l.id === currentLeagueId);

  const renderPage = () => {
    if (!currentLeague) {
      return (
        <MultiLeagueDashboard
          leagues={leagues}
          setCurrentLeagueId={setCurrentLeagueId}
          createLeague={createLeague}
        />
      );
    }
    return <LeagueView league={currentLeague} leagues={leagues} setLeagues={setLeagues} />;
  };

  return <div className="min-h-screen bg-gray-100 p-4">{renderPage()}</div>;
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
      case "teams":
        return <Teams teams={league.teams} />;
      case "leaderboard":
        return <Leaderboard teams={league.teams} />;
      case "lineups":
        return <Lineups teams={league.teams} setTeams={(teams) => updateLeague({ ...league, teams })} />;
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
        {["Dashboard","Teams","Leaderboard","Lineups","Free Agency"].map((p) => (
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
// Dashboard for Single League
// =====================
function DashboardLeague({ league }) {
  const top = [...league.teams].sort((a, b) => b.score - a.score)[0];
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card>
        <CardContent>
          <h2 className="font-bold text-lg">Top Team</h2>
          <p>{top?.name}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2 className="font-bold text-lg">Teams</h2>
          <p>{league.teams.length}</p>
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
// Teams Page
// =====================
function Teams({ teams }) {
  return (
    <div className="grid gap-4">
      {teams.map((t) => (
        <Card key={t.name}>
          <CardContent>
            <h2 className="font-bold text-lg">{t.name}</h2>
            <p className="text-gray-700">{t.score} pts</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {t.roster.map((p) => (
                <span key={p.name} className="px-2 py-1 bg-gray-100 rounded-full text-gray-800">{p.name}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =====================
// Leaderboard Page
// =====================
function Leaderboard({ teams }) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  return (
    <div className="grid gap-2">
      {sorted.map((t, i) => (
        <Card key={t.name} className={i===0 ? "bg-yellow-100" : ""}>
          <CardContent className="flex justify-between items-center">
            <span className="font-semibold text-gray-900">{i + 1}. {t.name}</span>
            <span className="text-gray-700">{t.score}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =====================
// Lineups Page
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
// Free Agency Page
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