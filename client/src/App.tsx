import { useState, useRef } from "react";
import { ScenarioProvider } from "./context/ScenarioContext";
import { SessionProvider } from "./context/SessionContext";
import { ScenarioPicker } from "./components/ScenarioPicker";
import { SimShell } from "./components/SimShell";
import { DebriefScreen } from "./components/DebriefScreen";
import { ScenarioBuilderScreen } from "./components/ScenarioBuilderScreen";
import { ErrorToast } from "./components/ErrorToast";
import type { LoadedScenario } from "./scenario/types";
import type { DebriefResult } from "@shared/types/events";

type AppScreen = "picker" | "sim" | "debrief" | "builder";

interface ActiveSession {
  scenario: LoadedScenario;
  debriefResult?: DebriefResult;
}

export function App() {
  const [screen, setScreen] = useState<AppScreen>("picker");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(null);
  }

  function handleStart(scenario: LoadedScenario) {
    setSession({ scenario });
    setScreen("sim");
  }

  function handleExpired() {
    setScreen("picker");
    setSession(null);
  }

  function handleDebriefReady(result: DebriefResult) {
    setSession((prev) => (prev ? { ...prev, debriefResult: result } : null));
    setScreen("debrief");
  }

  function handleBack() {
    setScreen("picker");
    setSession(null);
  }

  function handleRunAgain(scenarioId: string) {
    // Find the scenario from current session and restart
    if (session?.scenario.id === scenarioId) {
      const scenario = session.scenario;
      setSession({ scenario });
      setScreen("sim");
    } else {
      setScreen("picker");
      setSession(null);
    }
  }

  return (
    <>
      {screen === "picker" && (
        <ScenarioPicker
          onStart={handleStart}
          onCreateScenario={() => setScreen("builder")}
        />
      )}

      {screen === "builder" && (
        <ScenarioBuilderScreen onBack={() => setScreen("picker")} />
      )}

      {screen === "sim" && session && (
        <ScenarioProvider scenario={session.scenario}>
          <SessionProvider
            scenario={session.scenario}
            onExpired={handleExpired}
            onDebriefReady={handleDebriefReady}
            onError={showToast}
          >
            <SimShell onResolve={() => {}} />
          </SessionProvider>
        </ScenarioProvider>
      )}

      {screen === "debrief" && session?.debriefResult && (
        <DebriefScreen
          debriefResult={session.debriefResult}
          scenarioId={session.scenario.id}
          scenarioTitle={session.scenario.title}
          onBack={handleBack}
          onRunAgain={handleRunAgain}
        />
      )}

      <ErrorToast message={toastMessage} onDismiss={dismissToast} />
    </>
  );
}
