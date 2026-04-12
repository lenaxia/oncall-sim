import { useScenario } from "../context/ScenarioContext";
import { useSimClock } from "../hooks/useSimClock";
import { SimClockContext } from "../hooks/useSimClock";
import { useSession } from "../context/SessionContext";
import { SpeedControl } from "./SpeedControl";
import { CoachPanelShell } from "./CoachPanelShell";
import { DebugPanelShell } from "./DebugPanelShell";

const DEBUG = import.meta.env.VITE_DEBUG === "true";

export function Topbar() {
  const { scenario } = useScenario();
  const { state } = useSession();
  const clockInput = {
    simTime: state.simTime,
    speed: state.speed,
    paused: state.paused,
    clockAnchorMs: state.clockAnchorMs,
  };

  return (
    <SimClockContext.Provider value={clockInput}>
      <div className="flex-shrink-0 h-10 flex items-center border-b border-sim-border bg-sim-surface px-3 gap-3">
        {/* Scenario title */}
        <span className="text-xs font-semibold text-sim-text truncate flex-1">
          {scenario?.title ?? "On-Call Simulator"}
        </span>

        {/* Clock */}
        <ClockDisplay />

        {/* Speed control */}
        <SpeedControl />

        {/* Coach panel */}
        <CoachPanelShell />

        {/* LLM debug panel — only rendered when VITE_DEBUG=true */}
        {DEBUG && <DebugPanelShell />}
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
