// @ts-nocheck
"use client";
import { useState, useEffect } from "react";

// Simple built-in UI components (no external deps)
const Card = ({ children }) => (
  <div className="border rounded-2xl shadow-sm bg-white">{children}</div>
);
const CardContent = ({ children, className="" }) => (
  <div className={"p-4 text-black" + className}>{children}</div>
);
const Button = ({ children, onClick }) => (
  <button onClick={onClick} className="px-3 py-1 rounded-xl bg-blue-600 text-white hover:bg-blue-700">
    {children}
  </button>
);

// ✅ YOUR GOOGLE SHEET CSV LINK
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0cXnJ2EW3nbTb_cPDA4f1Nu8qhjfWPks-j-1UsQpcg3v1nNXEZShaDmAk3a3wjQ/pub?gid=576538322&single=true&output=csv";

export default function FantasyDiscGolfApp() {
  const [page, setPage] = useState("dashboard");
  const [teams, setTeams] = useState([
    { name: "Henry", roster: [], starters: [], score: 0 },
    { name: "Paige", roster: [], starters: [], score: 0 },
    { name: "Ethan", roster: [], starters: [], score: 0 },
    { name: "Isaac", roster: [], starters: [], score: 0 },
    { name: "Dad", roster: [], starters: [], score: 0 },
    { name: "Mom", roster: [], starters: [], score: 0 },
  ]);
  const [players, setPlayers] = useState([]);
  const [freeAgents, setFreeAgents] = useState([]);

  // 🔗 LOAD DATA
  useEffect(() => {
    fetch(SHEET_URL)
      .then((res) => res.text())
      .then((data) => {
        const rows = data.split("\n").slice(1);
        const parsed = rows
          .map((r) => {
            const [name, division, points] = r.split(",");
            return {
              name: name?.trim(),
              division: division?.trim(),
              points: Number(points || 0),
            };
          })
          .filter((p) => p.name);

        setPlayers(parsed);
        setFreeAgents(parsed);
      })
      .catch(() => {
        // ⚠️ Fallback if internet access is blocked
        const fallback = [
          { name: "Calvin Heimburg", division: "MPO", points: 48 },
          { name: "Paul McBeth", division: "MPO", points: 45 },
          { name: "Kristin Tattar", division: "FPO", points: 40 },
        ];
        setPlayers(fallback);
        setFreeAgents(fallback);
      });
  }, []);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard teams={teams} />;
      case "teams":
        return <Teams teams={teams} />;
      case "leaderboard":
        return <Leaderboard teams={teams} />;
      case "lineups":
        return <Lineups teams={teams} setTeams={setTeams} />;
      case "freeagency":
        return <FreeAgency teams={teams} setTeams={setTeams} freeAgents={freeAgents} setFreeAgents={setFreeAgents} />;
      default:
        return <Dashboard teams={teams} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <nav className="flex gap-2 mb-6 flex-wrap">
        {["dashboard","teams","leaderboard","lineups","freeagency"].map((p) => (
          <Button key={p} onClick={() => setPage(p)}>{p}</Button>
        ))}
      </nav>

      <div className="transition-opacity duration-300">
        {renderPage()}
      </div>
    </div>
  );
}

function Dashboard({ teams }) {
  const top = [...teams].sort((a,b)=>b.score-a.score)[0];
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card><CardContent><h2 className="font-semibold">Top Team</h2><p>{top?.name}</p></CardContent></Card>
      <Card><CardContent><h2 className="font-semibold">Teams</h2><p>{teams.length}</p></CardContent></Card>
      <Card><CardContent><h2 className="font-semibold">Status</h2><p>Live</p></CardContent></Card>
    </div>
  );
}

function Teams({ teams }) {
  return (
    <div className="grid gap-4">
      {teams.map(t=> (
        <Card key={t.name}><CardContent>
          <h2 className="font-semibold">{t.name}</h2>
          <p>{t.score} pts</p>
          {t.roster.map(p=> <div key={p.name}>{p.name}</div>)}
        </CardContent></Card>
      ))}
    </div>
  );
}

function Leaderboard({ teams }) {
  const sorted=[...teams].sort((a,b)=>b.score-a.score);
  return (
    <div className="grid gap-3">
      {sorted.map((t,i)=> (
        <Card key={t.name}><CardContent className="flex justify-between">
          <span>#{i+1} {t.name}</span><span>{t.score}</span>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Lineups({ teams,setTeams }) {
  const toggleStarter = (ti, player)=>{
    const t=[...teams];
    const starters=t[ti].starters;
    const exists=starters.find(p=>p.name===player.name);

    if(exists){
      t[ti].starters=starters.filter(p=>p.name!==player.name);
    } else {
      t[ti].starters=[...starters, player];
    }
    setTeams(t);
  };

  return (
    <div className="grid gap-4">
      {teams.map((t,i)=>(
        <Card key={t.name}><CardContent>
          <h2 className="font-semibold">{t.name} Lineup</h2>
          {t.roster.map(p=>(
            <div key={p.name} className="flex justify-between items-center">
              {p.name}
              <Button onClick={()=>toggleStarter(i,p)}>Toggle</Button>
            </div>
          ))}
        </CardContent></Card>
      ))}
    </div>
  );
}

function FreeAgency({ teams,setTeams,freeAgents,setFreeAgents }) {
  const addPlayer=(teamIndex,p)=>{
    const t=[...teams];
    t[teamIndex].roster.push(p);
    setTeams(t);
    setFreeAgents(freeAgents.filter(x=>x.name!==p.name));
  };

  return (
    <div className="grid gap-3">
      {freeAgents.map(p=>(
        <Card key={p.name}><CardContent className="flex justify-between items-center">
          <span>{p.name}</span>
          <Button onClick={()=>addPlayer(0,p)}>Add</Button>
        </CardContent></Card>
      ))}
    </div>
  );
}
