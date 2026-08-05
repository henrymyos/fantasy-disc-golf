import type { ReactNode } from "react";

// Renders the light markdown produced by generateWeeklyRecap: `**bold**`
// spans, `- ` matchup bullets, and "emoji **Award:** value" lines. Legacy
// recaps (a single plain paragraph) fall back to paragraph rendering.

function renderBold(text: string, keyPrefix: string): ReactNode[] {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-white">
        {part}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

const AWARD_RE = /^(\p{Extended_Pictographic}\S*)\s+\*\*(.+?):\*\*\s*(.*)$/u;

export function WeeklyRecapCard({
  week,
  body,
  createdAt,
}: {
  week: number;
  body: string;
  createdAt: string | null;
}) {
  const rawLines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const bullets = rawLines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const awards = rawLines
    .map((l) => AWARD_RE.exec(l))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => ({ emoji: m[1], title: m[2], value: m[3] }));
  const isLegacy = bullets.length === 0 && awards.length === 0;

  return (
    <div className="bg-[#1a1d23] rounded-2xl p-5 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-white">Week {week} Recap</h2>
        {createdAt && (
          <span className="text-gray-400 text-xs">
            {new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {isLegacy ? (
        <p className="text-gray-200 text-sm leading-relaxed">{body}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {bullets.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-gray-300 text-sm leading-relaxed">
                <span className="text-[#4B3DFF] mt-[1px] shrink-0" aria-hidden>
                  ▸
                </span>
                <span>{renderBold(line, `b${i}`)}</span>
              </li>
            ))}
          </ul>

          {awards.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">
                Weekly Awards
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {awards.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 bg-[#0f1117] border border-white/5 rounded-xl px-3 py-2.5"
                  >
                    <span className="text-lg leading-none mt-0.5 shrink-0" aria-hidden>
                      {a.emoji}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-400 text-[11px] font-semibold uppercase tracking-wide">
                        {a.title}
                      </p>
                      <p className="text-gray-200 text-sm leading-snug mt-0.5">
                        {renderBold(a.value, `a${i}`)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
