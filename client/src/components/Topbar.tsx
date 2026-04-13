import { useScenario } from "../context/ScenarioContext";
import { useSimClock } from "../hooks/useSimClock";
import { SimClockContext } from "../hooks/useSimClock";
import { useSession } from "../context/SessionContext";
import { SpeedControl } from "./SpeedControl";
import { CoachPanelShell } from "./CoachPanelShell";
import { DebugPanelShell } from "./DebugPanelShell";

// ── GitHub mark SVG (official simple mark, 16px) ─────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
        -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
        .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
        -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
        .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
        .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
        0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function Topbar() {
  const { scenario } = useScenario();
  const { state } = useSession();
  const clockInput = {
    simTime: state.simTime,
    speed: state.speed,
    paused: state.paused,
    clockAnchorMs: state.clockAnchorMs,
  };
  const debug = window.__CONFIG__?.debug === true;

  return (
    <SimClockContext.Provider value={clockInput}>
      <div className="flex-shrink-0 h-10 flex items-center border-b border-sim-border bg-sim-surface px-3 gap-3">
        {/* Scenario title */}
        <span className="text-xs font-semibold text-sim-text truncate flex-1">
          {scenario?.title ?? "On-Call Simulator"}
        </span>

        {/* GitHub link */}
        <a
          href="https://github.com/lenaxia/oncall-sim"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          title="View source on GitHub"
          className="flex-shrink-0 text-sim-text-muted hover:text-sim-text transition-colors duration-75"
        >
          <GitHubIcon className="w-4 h-4" />
        </a>

        {/* Clock */}
        <ClockDisplay />

        {/* Speed control */}
        <SpeedControl />

        {/* Coach panel */}
        <CoachPanelShell />

        {/* LLM debug panel — only rendered when DEBUG=true at runtime */}
        {debug && <DebugPanelShell />}
      </div>
    </SimClockContext.Provider>
  );
}

function ClockDisplay() {
  const { display, paused } = useSimClock();
  return (
    <span
      className={`text-xs tabular-nums font-mono ${paused ? "text-sim-yellow" : "text-sim-text-muted"}`}
    >
      {display}
      {paused && <span className="ml-1 text-sim-yellow">(paused)</span>}
    </span>
  );
}
