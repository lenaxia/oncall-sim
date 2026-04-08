import { describe, it, expect } from 'vitest'
import {
  getStakeholderTools, getCoachTools, validateToolCall,
  COMMUNICATION_TOOLS, COACH_TOOLS,
} from '../../src/llm/tool-definitions'
import { getFixtureScenario, clearFixtureCache } from '../../src/testutil/index'
import { beforeEach } from 'vitest'
import type { LoadedScenario } from '../../src/scenario/types'

beforeEach(() => clearFixtureCache())

// ── getStakeholderTools ───────────────────────────────────────────────────────

describe('getStakeholderTools', () => {
  it('includes all COMMUNICATION_TOOLS always', () => {
    const scenario = getFixtureScenario()
    const tools    = getStakeholderTools(scenario)
    for (const commTool of COMMUNICATION_TOOLS) {
      expect(tools.find(t => t.name === commTool.name)).toBeDefined()
    }
  })

  it('includes only EVENT_TOOLS enabled in llm_event_tools config', () => {
    const scenario = getFixtureScenario()
    // Fixture has: fire_alarm (max_calls:1), inject_log_entry (enabled:true)
    const tools  = getStakeholderTools(scenario)
    const names  = tools.map(t => t.name)
    expect(names).toContain('fire_alarm')
    expect(names).toContain('inject_log_entry')
  })

  it('trigger_metric_recovery never included (Phase 2)', () => {
    const scenario: LoadedScenario = {
      ...getFixtureScenario(),
      engine: {
        tickIntervalSeconds: 10,
        llmEventTools: [{ tool: 'trigger_metric_recovery' }],
      },
    }
    const tools = getStakeholderTools(scenario)
    expect(tools.find(t => t.name === 'trigger_metric_recovery')).toBeUndefined()
  })

  it('trigger_metric_spike never included (Phase 2)', () => {
    const scenario: LoadedScenario = {
      ...getFixtureScenario(),
      engine: {
        tickIntervalSeconds: 10,
        llmEventTools: [{ tool: 'trigger_metric_spike' }],
      },
    }
    const tools = getStakeholderTools(scenario)
    expect(tools.find(t => t.name === 'trigger_metric_spike')).toBeUndefined()
  })

  it('EVENT_TOOL not in llm_event_tools config is excluded', () => {
    const scenario: LoadedScenario = {
      ...getFixtureScenario(),
      engine: { tickIntervalSeconds: 10, llmEventTools: [] },
    }
    const tools = getStakeholderTools(scenario)
    // Only communication tools
    expect(tools.length).toBe(COMMUNICATION_TOOLS.length)
  })
})

describe('getCoachTools', () => {
  it('returns COACH_TOOLS', () => {
    const tools = getCoachTools()
    for (const ct of COACH_TOOLS) {
      expect(tools.find(t => t.name === ct.name)).toBeDefined()
    }
  })
})

// ── validateToolCall ──────────────────────────────────────────────────────────

describe('validateToolCall', () => {
  it('valid send_message call → valid=true', () => {
    const scenario = getFixtureScenario()
    const result   = validateToolCall(
      { tool: 'send_message', params: { persona: 'p1', channel: '#inc', message: 'hi' } },
      scenario, {}
    )
    expect(result.valid).toBe(true)
  })

  it('send_message with missing params → valid=false with reason', () => {
    const scenario = getFixtureScenario()
    const result   = validateToolCall(
      { tool: 'send_message', params: { persona: 'p1' } },  // missing channel and message
      scenario, {}
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('fire_alarm within max_calls → valid=true', () => {
    const scenario = getFixtureScenario()
    // Fixture has fire_alarm with max_calls: 1
    const activeTools = getStakeholderTools(scenario)
    const result = validateToolCall(
      { tool: 'fire_alarm', params: { alarm_id: 'a1', service: 'svc', severity: 'SEV2', message: 'alert' } },
      scenario, { fire_alarm: 0 }, activeTools
    )
    expect(result.valid).toBe(true)
  })

  it('fire_alarm exceeding max_calls → valid=false', () => {
    const scenario = getFixtureScenario()
    // max_calls is 1 in fixture
    const activeTools = getStakeholderTools(scenario)
    const result = validateToolCall(
      { tool: 'fire_alarm', params: { alarm_id: 'a1', service: 'svc', severity: 'SEV2', message: 'alert' } },
      scenario, { fire_alarm: 1 }, activeTools  // already called once
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('max_calls')
  })

  it('trigger_cascade for allowed service → valid=true', () => {
    const scenario: LoadedScenario = {
      ...getFixtureScenario(),
      engine: {
        tickIntervalSeconds: 10,
        llmEventTools: [
          { tool: 'trigger_cascade', services: ['downstream-svc'] },
        ],
      },
    }
    const activeTools = getStakeholderTools(scenario)
    const result = validateToolCall(
      { tool: 'trigger_cascade', params: { service: 'downstream-svc', reason: 'cascade' } },
      scenario, {}, activeTools
    )
    expect(result.valid).toBe(true)
  })

  it('trigger_cascade for disallowed service → valid=false', () => {
    const scenario: LoadedScenario = {
      ...getFixtureScenario(),
      engine: {
        tickIntervalSeconds: 10,
        llmEventTools: [
          { tool: 'trigger_cascade', services: ['allowed-svc'] },
        ],
      },
    }
    const activeTools = getStakeholderTools(scenario)
    const result = validateToolCall(
      { tool: 'trigger_cascade', params: { service: 'not-allowed', reason: 'cascade' } },
      scenario, {}, activeTools
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not-allowed')
  })

  it('trigger_metric_recovery → always valid=false with Phase 2 reason', () => {
    const scenario = getFixtureScenario()
    const result   = validateToolCall(
      { tool: 'trigger_metric_recovery', params: { service: 'svc' } },
      scenario, {}
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Phase 2')
  })

  it('trigger_metric_spike → always valid=false with Phase 2 reason', () => {
    const scenario = getFixtureScenario()
    const result   = validateToolCall(
      { tool: 'trigger_metric_spike', params: { service: 'svc', metric_id: 'error_rate', magnitude: 5 } },
      scenario, {}
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Phase 2')
  })

  it('silence_alarm for non-existent alarm → valid=false', () => {
    const scenario     = getFixtureScenario()
    const activeAlarms = new Set<string>(['existing-alarm'])
    // silence_alarm is not in fixture's llm_event_tools so it won't be active
    // but validateToolCall can still be called directly with the tool name by adding it to active tools
    const activeToolsWithSilence = [
      ...getStakeholderTools(scenario),
      { name: 'silence_alarm', description: '', parameters: { type: 'object', properties: { alarm_id: { type: 'string' } }, required: ['alarm_id'] } },
    ]
    const result2 = validateToolCall(
      { tool: 'silence_alarm', params: { alarm_id: 'ghost-alarm' } },
      scenario, {}, activeToolsWithSilence, activeAlarms
    )
    expect(result2.valid).toBe(false)
    expect(result2.reason).toContain('ghost-alarm')
  })

  it('tool not in active tools → valid=false', () => {
    const scenario = getFixtureScenario()
    const result   = validateToolCall(
      { tool: 'nonexistent_tool', params: {} },
      scenario, {}
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('nonexistent_tool')
  })
})
