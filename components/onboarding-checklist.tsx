import Link from "next/link";
import type { SetupStep } from "@/lib/league-setup";

/**
 * Guided setup checklist for a new commissioner. Renders the ordered steps with
 * completion state; the first unfinished step is highlighted as "next up".
 * Caller decides whether to render (typically only while setup is incomplete).
 */
export function OnboardingChecklist({
  steps,
  variant = "card",
}: {
  steps: SetupStep[];
  variant?: "card" | "bare";
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div
      className={
        variant === "card"
          ? "bg-[#1a1d23] rounded-2xl p-5 border border-[#4B3DFF]/30"
          : ""
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-white">Get your league ready</h2>
        <span className="text-gray-400 text-xs">{doneCount}/{steps.length} done</span>
      </div>

      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-4">
        <div
          className="h-full bg-[#4B3DFF] transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((step, i) => {
          const isNext = i === nextIndex;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition ${
                  step.done
                    ? "border-transparent hover:bg-white/5"
                    : isNext
                      ? "border-[#4B3DFF]/40 bg-[#4B3DFF]/10 hover:bg-[#4B3DFF]/15"
                      : "border-white/5 hover:bg-white/5"
                }`}
              >
                <span
                  className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    step.done
                      ? "bg-[#36D7B7] text-black"
                      : isNext
                        ? "bg-[#4B3DFF] text-white"
                        : "bg-white/10 text-gray-400"
                  }`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium leading-tight ${step.done ? "text-gray-400" : "text-white"}`}>
                    {step.label}
                  </p>
                  <p className="text-gray-500 text-xs truncate">{step.detail}</p>
                </div>
                {isNext && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#a09aff]">
                    Next
                  </span>
                )}
                {!step.done && !isNext && <span className="shrink-0 text-gray-500 text-sm">→</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
