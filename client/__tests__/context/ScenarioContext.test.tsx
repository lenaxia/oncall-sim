import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { ScenarioProvider, useScenario } from '../../src/context/ScenarioContext'
import { server } from '../../src/testutil/setup'
import { http } from 'msw'

// ── Helper: render hook inside ScenarioProvider ────────────────────────────────
function makeWrapper(scenarioId = '_fixture') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ScenarioProvider scenarioId={scenarioId}>{children}</ScenarioProvider>
  }
}

describe('ScenarioContext', () => {
  describe('initial state', () => {
    it('scenario is null before fetch completes', async () => {
      // Block fetch indefinitely
      server.use(
        http.get('/api/scenarios/:id', () => new Promise(() => {}))
      )
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      expect(result.current.scenario).toBeNull()
    })
  })

  describe('after successful fetch', () => {
    it('scenario is populated with title', async () => {
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      // Wait for fetch to complete
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.scenario).not.toBeNull()
      expect(result.current.scenario!.title).toBe('Fixture Scenario')
    })

    it('scenario has personas with jobTitle and team', async () => {
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      await act(async () => { await Promise.resolve() })
      const persona = result.current.scenario!.personas[0]
      expect(persona.displayName).toBe('Fixture Persona')
      expect(persona.jobTitle).toBe('Senior SRE')
      expect(persona.team).toBe('Platform')
    })

    it('scenario has wikiPages array', async () => {
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      await act(async () => { await Promise.resolve() })
      expect(result.current.scenario!.wikiPages).toHaveLength(1)
      expect(result.current.scenario!.wikiPages[0].title).toBe('Architecture')
    })

    it('scenario.engine.defaultTab is populated', async () => {
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      await act(async () => { await Promise.resolve() })
      expect(result.current.scenario!.engine.defaultTab).toBe('email')
    })

    it('scenario.engine.hasFeatureFlags is false for fixture', async () => {
      const { result } = renderHook(() => useScenario(), { wrapper: makeWrapper() })
      await act(async () => { await Promise.resolve() })
      expect(result.current.scenario!.engine.hasFeatureFlags).toBe(false)
    })
  })

  describe('useScenario hook', () => {
    it('throws when used outside ScenarioProvider', () => {
      // Suppress the React error boundary noise
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => renderHook(() => useScenario())).toThrow()
      consoleSpy.mockRestore()
    })
  })
})
