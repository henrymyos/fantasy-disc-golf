const PDGA_BASE = "https://api.pdga.com/services/json";

let sessionCookie: string | null = null;
let sessionToken: string | null = null;

async function login(): Promise<boolean> {
  const username = process.env.PDGA_USERNAME;
  const password = process.env.PDGA_PASSWORD;
  if (!username || !password) return false;

  try {
    const res = await fetch(`${PDGA_BASE}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json();
    sessionCookie = res.headers.get("set-cookie");
    sessionToken = data.token;
    return true;
  } catch {
    return false;
  }
}

async function pdgaFetch(path: string) {
  if (!sessionCookie) {
    const ok = await login();
    if (!ok) return null;
  }
  try {
    const res = await fetch(`${PDGA_BASE}${path}`, {
      headers: {
        Cookie: sessionCookie ?? "",
        "X-CSRF-Token": sessionToken ?? "",
      },
      next: { revalidate: 300 }, // cache 5 min
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getRecentEvents(limit = 10) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 60);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const data = await pdgaFetch(
    `/event?start_date=${fmt(start)}&end_date=${fmt(today)}&tier[]=M&tier[]=A&tier[]=ES&limit=${limit}&sort=date&order=DESC`
  );
  return data?.session?.result ?? [];
}

export async function getEventResults(eventId: number) {
  const data = await pdgaFetch(`/event/${eventId}/results`);
  return data?.session?.result ?? [];
}

export type PDGAEvent = {
  tournament_id: number;
  tournament_name: string;
  start_date: string;
  end_date: string;
  city: string;
  state_prov: string;
  country: string;
  tier: string;
  status: string;
};
