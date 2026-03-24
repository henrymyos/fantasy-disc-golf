// @ts-nocheck
"use client";
import { useState, useEffect } from "react";

// Simple built-in UI components (no external deps)
const Card = ({ children }) => (
  <div className="border rounded-2xl shadow-sm bg-white">{children}</div>
);

const CardContent = ({ children, className = "" }) => (
  <div className={"p-4 text-black " + className}>{children}</div>
);

const Button = ({ children, onClick }) => (
  <button
    onClick={onClick}
    className="px-3 py-1 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
  >
    {children}
  </button>
);

// ✅ YOUR GOOGLE SHEET CSV LINK
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0cXnJ2EW3nbTb_cPDA4f1Nu8qhjfWPks-j-1UsQpcg3v1nNXEZShaDmAk3a3wjQ/pub?gid=576538322&single=true&output=csv";

export default function FantasyDiscGolfApp() {
  const [page, setPage] = useState("dashboard");
  const [leagues, setLeagues] = useState([]);
  const [currentLeagueId, setCurrentLeagueId] = useState(null);

  // Load players from Google Sheet
  const [allPlayers, setAllPlayers] = useState([]);
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
    // If no league selected, show multi-league dashboard
    if (!currentLeague) {
      return (
        <MultiLeagueDashboard
          leagues={leagues}
          setCurrentLeagueId={setCurrentLeagueId}
          createLeague={createLeague}
        />
      );
    }

    // League-specific pages
    return (
      <LeagueView
        league={currentLeague}
        setLeagues={setLeagues}
        leagues={leagues}
      />
    );
  };

  return <div className="min-h-screen bg-gray-100 p-4">{renderPage()}</div>;
}

// =================== Multi-League Dashboard ===================
function MultiLeagueDashboard({ leagues, setCurrentLeagueId, createLeague }) {
  return (
    <div className="grid gap-4">
      <h2 className="font-semibold text-black text-xl mb-2">Your Leagues</h2>

      {leagues.map((league) => (
        <Card key={league.id}>
          <CardContent className="flex justify-between items-center text-black">
            <span>{league.name}</span>
            <Button onClick={() => setCurrentLeagueId(league.id)}>Enter</Button>
          </CardContent>
        </Card>
      ))}

      <Button
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

// =================== League View ===================
function LeagueView({ league, setLeagues, leagues }) {
  const [page, setPage] = useState("dashboard");

  const updateLeague = (updatedLeague) => {
    const updatedLeagues = leagues.map((l) =>
      l.id === updatedLeague.id ? updatedLeague : l
    );
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
      <nav className="flex gap-2 mb-6 flex-wrap">
        {["dashboard", "teams", "leaderboard", "lineups", "freeagency"].map(
          (p) => (
            <Button key={p} onClick={() => setPage(p)}>
              {p}
            </Button>
          )
        )}
      </nav>
      {renderLeaguePage()}
    </div>
  );
}

// =================== Dashboard for a single league ===================
function DashboardLeague({ league }) {
  const top = [...league.teams].sort((a, b) => b.score - a.score)[0];
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card>
        <CardContent>
          <h2 className="font-semibold">Top Team</h2>
          <p>{top?.name}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2 className="font-semibold">Teams</h2>
          <p>{league.teams.length}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2 className="font-semibold">Status</h2>
          <p>Live</p>
        </CardContent>
      </Card>
    </div>
  );
}

// =================== Teams ===================
function Teams({ teams }) {
  return (
    <div className="grid gap-4">
      {teams.map((t) => (
        <Card key={t.name}>
          <CardContent>
            <h2 className="font-semibold">{t.name}</h2>
            <p>{t.score} pts</p>
            {t.roster.map((p) => (
              <div key={p.name}>{p.name}</div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =================== Leaderboard ===================
function Leaderboard({ teams }) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  return (
    <div className="grid gap-3">
      {sorted.map((t, i) => (
        <Card key={t.name}>
          <CardContent className="flex justify-between text-black">
            <span className="font-semibold">
              #{i + 1} {t.name}
            </span>
            <span>{t.score}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =================== Lineups ===================
function Lineups({ teams, setTeams }) {
  const toggleStarter = (ti, player) => {
    const t = [...teams];
    const starters = t[ti].starters;
    const exists = starters.find((p) => p.name === player.name);

    if (exists) {
      t[ti].starters = starters.filter((p) => p.name !== player.name);
    } else {
      t[ti].starters = [...starters, player];
    }
    setTeams(t);
  };

  return (
    <div className="grid gap-4">
      {teams.map((t, i) => (
        <Card key={t.name}>
          <CardContent>
            <h2 className="font-semibold">{t.name} Lineup</h2>
            {t.roster.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 text-black"
              >
                <Button onClick={() => toggleStarter(i, p)}>Toggle</Button>
                <span>{p.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =================== Free Agency ===================
function FreeAgency({ teams, setTeams, freeAgents, setFreeAgents }) {
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(
    teams.length > 0 ? 0 : -1
  );

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
          <CardContent className="flex items-center gap-2 text-black">
            <select
              className="border rounded px-1 py-0.5"
              value={selectedTeamIndex}
              onChange={(e) => setSelectedTeamIndex(Number(e.target.value))}
            >
              {teams.map((t, i) => (
                <option key={i} value={i}>
                  {t.name}
                </option>
              ))}
            </select>

            <Button onClick={() => addPlayer(selectedTeamIndex, p)}>Add</Button>
            <span>{p.name}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}