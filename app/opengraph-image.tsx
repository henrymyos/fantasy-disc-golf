import { ImageResponse } from "next/og";

export const alt = "Fantasy Disc Golf — leagues, live drafts, weekly matchups, real PDGA scoring";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PURPLE = "#4B3DFF";
const BG = "#0f1117";
const CARD = "#171a23";
const BORDER = "#262a36";
const MUTED = "#8b90a3";

// Fake matchup rows so the preview hints at the real dashboard.
const MATCHUPS = [
  { home: "Chain Reaction", hs: "412.5", away: "Hyzer Flip", as: "398.0" },
  { home: "Tree Love", hs: "387.5", away: "Ace Run", as: "401.5" },
  { home: "Parked", hs: "356.0", away: "Mando Gang", as: "349.5" },
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          color: "white",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          padding: 56,
        }}
      >
        {/* Left: title block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 560,
            paddingRight: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: PURPLE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 800,
              }}
            >
              F
            </div>
            <div style={{ fontSize: 24, color: MUTED, fontWeight: 600 }}>
              fantasy-disc-golf-seven.vercel.app
            </div>
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              marginBottom: 24,
            }}
          >
            Fantasy Disc Golf
          </div>
          <div style={{ fontSize: 28, color: MUTED, lineHeight: 1.35 }}>
            {"Leagues · Live snake & auction drafts · Weekly matchups · Scoring from real PDGA results"}
          </div>
        </div>

        {/* Right: mini dashboard card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            background: CARD,
            border: `2px solid ${BORDER}`,
            borderRadius: 20,
            padding: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700 }}>Week 14 Matchups</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "white",
                background: PURPLE,
                borderRadius: 999,
                padding: "6px 14px",
              }}
            >
              LIVE
            </div>
          </div>
          {MATCHUPS.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: BG,
                border: `2px solid ${BORDER}`,
                borderRadius: 14,
                padding: "16px 20px",
                marginBottom: 14,
                fontSize: 22,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 700 }}>{m.home}</div>
                <div style={{ color: MUTED, fontSize: 18 }}>{`${m.hs} pts`}</div>
              </div>
              <div style={{ color: MUTED, fontWeight: 700 }}>vs</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "flex-end",
                }}
              >
                <div style={{ fontWeight: 700 }}>{m.away}</div>
                <div style={{ color: MUTED, fontSize: 18 }}>{`${m.as} pts`}</div>
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: "auto",
              fontSize: 18,
              color: MUTED,
            }}
          >
            <div style={{ background: BG, borderRadius: 999, padding: "6px 14px" }}>
              130-player MPO/FPO pool
            </div>
            <div style={{ background: BG, borderRadius: 999, padding: "6px 14px" }}>
              Installable PWA
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
