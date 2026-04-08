import { useState, useRef } from 'react'
import { ScenarioProvider }  from './context/ScenarioContext'
import { SessionProvider }   from './context/SessionContext'
import { ScenarioPicker }    from './components/ScenarioPicker'
import { SimShell }          from './components/SimShell'
import { DebriefScreen }     from './components/DebriefScreen'
import { ErrorToast }        from './components/ErrorToast'

type AppScreen = 'picker' | 'sim' | 'debrief'

interface ActiveSession {
  sessionId:    string
  scenarioId:   string
  scenarioTitle: string
}

export function App() {
  const [screen,       setScreen]       = useState<AppScreen>('picker')
  const [session,      setSession]      = useState<ActiveSession | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(msg)
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000)
  }

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(null)
  }

  async function handleStart(scenarioId: string) {
    // POST /api/sessions
    let sessionId: string
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId }),
      })
      if (!res.ok) throw new Error('session creation failed')
      const data = await res.json() as { sessionId: string }
      sessionId = data.sessionId
    } catch {
      showToast('Failed to start session. Please try again.')
      return
    }

    // GET /api/scenarios/:id — fetch scenario title
    let title = scenarioId
    try {
      const res = await fetch(`/api/scenarios/${scenarioId}`)
      if (res.ok) {
        const data = await res.json() as { title: string }
        title = data.title
      }
    } catch { /* use scenarioId as fallback title */ }

    setSession({ sessionId, scenarioId, scenarioTitle: title })
    setScreen('sim')
  }

  function handleExpired() {
    setScreen('picker')
    setSession(null)
  }

  function handleDebriefReady() {
    setScreen('debrief')
  }

  function handleBack() {
    setScreen('picker')
    setSession(null)
  }

  function handleRunAgain(scenarioId: string) {
    setScreen('picker')
    setSession(null)
    // Re-start immediately with same scenario
    void handleStart(scenarioId)
  }

  return (
    <>
      {screen === 'picker' && (
        <ScenarioPicker onStart={handleStart} />
      )}

      {screen === 'sim' && session && (
        <ScenarioProvider scenarioId={session.scenarioId}>
          <SessionProvider
            sessionId={session.sessionId}
            onExpired={handleExpired}
            onDebriefReady={handleDebriefReady}
            onError={showToast}
          >
            <SimShell onResolve={handleDebriefReady} />
          </SessionProvider>
        </ScenarioProvider>
      )}

      {screen === 'debrief' && session && (
        <DebriefScreen
          sessionId={session.sessionId}
          scenarioId={session.scenarioId}
          scenarioTitle={session.scenarioTitle}
          onBack={handleBack}
          onRunAgain={handleRunAgain}
        />
      )}

      <ErrorToast message={toastMessage} onDismiss={dismissToast} />
    </>
  )
}
