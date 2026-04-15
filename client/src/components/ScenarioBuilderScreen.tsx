// ScenarioBuilderScreen.tsx — full-screen scenario builder layout.
// Two-column split: left 2/3 ScenarioCanvas, right 1/3 ScenarioBuilderChat.

import React from "react";
import { ScenarioCanvas } from "./ScenarioCanvas";
import { ScenarioBuilderChat } from "./ScenarioBuilderChat";
import { Button } from "./Button";
import { useScenarioBuilder } from "../hooks/useScenarioBuilder";

interface ScenarioBuilderScreenProps {
  onBack: () => void;
}

export function ScenarioBuilderScreen({ onBack }: ScenarioBuilderScreenProps) {
  const { state, sendMessage, downloadYaml, reset } = useScenarioBuilder();

  const canDownload = state.validatedYaml !== null;
  const hasWarnings = state.validationErrors.length > 0;

  function handleBack() {
    reset();
    onBack();
  }

  return (
    <div className="h-full flex flex-col bg-sim-bg overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-sim-border bg-sim-surface">
        <button
          onClick={handleBack}
          className="text-xs text-sim-text-muted hover:text-sim-text transition-colors flex items-center gap-1"
        >
          ← Back to scenarios
        </button>

        <span className="text-xs font-semibold text-sim-text">
          Create Scenario
        </span>

        <Button
          variant={canDownload && !hasWarnings ? "primary" : "secondary"}
          size="sm"
          disabled={!canDownload}
          onClick={downloadYaml}
        >
          {!canDownload
            ? "Download scenario.yaml"
            : hasWarnings
              ? "Download (warnings)"
              : "Download scenario.yaml"}
        </Button>
      </div>

      {/* Two-column body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left 2/3 — scenario canvas */}
        <div className="flex-[2] overflow-hidden border-r border-sim-border">
          <ScenarioCanvas
            draft={state.draft}
            assumptions={state.assumptions}
            validationErrors={state.validationErrors}
            thinking={state.thinking}
          />
        </div>

        {/* Right 1/3 — chat */}
        <div className="flex-[1] overflow-hidden">
          <ScenarioBuilderChat
            messages={state.messages}
            thinking={state.thinking}
            onSend={sendMessage}
          />
        </div>
      </div>
    </div>
  );
}
