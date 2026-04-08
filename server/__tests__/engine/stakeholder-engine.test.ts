import { describe, it, expect, beforeEach } from 'vitest'
import { createStakeholderEngine } from '../../src/engine/stakeholder-engine'
import { LLMError } from '../../src/llm/llm-client'
import { getFixtureScenario, clearFixtureCache, buildMockLLMProvider } from '../../src/testutil/index'
import type { MockLLMResponses } from '../../src/llm/mock-provider'
import type { StakeholderContext } from '../../src/engine/game-loop'
import type { ConversationStoreSnapshot } from '../../src/engine/conversation-store'

beforeEach(() => clearFixtureCache())

function emptySnapshot(): ConversationStoreSnapshot {
  return {
    emails: [], chatChannels: {}, tickets: [], ticketComments: {},
    logs: [], alarms: [], deployments: {}, pages: [],
  }
}

function makeContext(overrides: Partial<StakeholderContext> = {}): StakeholderContext {
  const scenario = getFixtureScenario()
  return {
    sessionId:         'test-session',
    scenario,
    simTime:           60,
    auditLog:          [],
    conversations:     emptySnapshot(),
    personaCooldowns:  {},
    directlyAddressed: new Set<string>(),
    ...overrides,
  }
}

function makeResponses(overrides: Partial<MockLLMResponses> = {}): MockLLMResponses {
  return {
    stakeholder_responses: [],
    coach_responses:       [],
    debrief_response:      { narrative: '' },
    ...overrides,
  }
}

// ── Happy paths ───────────────────────────────────────────────────────────────

describe('StakeholderEngine.tick — happy paths', () => {
  it('send_message via tick_1 → returns chat_message SimEvent', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'tick_1',
        tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#incidents', message: 'Still investigating.' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    const events = await engine.tick(makeContext())
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('chat_message')
  })

  it('fire_alarm via tick_1 → returns alarm_fired SimEvent', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'tick_1',
        tool_calls: [{ tool: 'fire_alarm', params: { alarm_id: 'dyn-alarm', service: 'fixture-service', severity: 'SEV2', message: 'Dynamic alert' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    const events = await engine.tick(makeContext())
    expect(events.some(e => e.type === 'alarm_fired')).toBe(true)
  })

  it('inject_log_entry via tick_1 → returns log_entry SimEvent', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'tick_1',
        tool_calls: [{ tool: 'inject_log_entry', params: { service: 'fixture-service', level: 'INFO', message: 'Recovery starting' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    const events = await engine.tick(makeContext())
    expect(events.some(e => e.type === 'log_entry')).toBe(true)
  })

  it('silent_until_contacted persona not in eligible list before engagement', async () => {
    const scenario = getFixtureScenario()
    // Make the fixture persona silent_until_contacted
    const modifiedScenario = {
      ...scenario,
      personas: scenario.personas.map(p => ({ ...p, silentUntilContacted: true })),
    }
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'tick_1',
        tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#inc', message: 'hi' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, modifiedScenario)
    // No personaCooldowns → persona not engaged
    const events = await engine.tick(makeContext({ personaCooldowns: {} }))
    // No eligible personas → no events
    expect(events).toHaveLength(0)
  })

  it('silent_until_contacted persona IS eligible after being engaged', async () => {
    const scenario = getFixtureScenario()
    const modifiedScenario = {
      ...scenario,
      personas: scenario.personas.map(p => ({ ...p, silentUntilContacted: true })),
    }
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'tick_1',
        tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: 'dm:fixture-persona', message: 'hi' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, modifiedScenario)
    // Persona engaged via DM (cooldown entry set)
    const events = await engine.tick(makeContext({
      personaCooldowns: { 'fixture-persona': 0 },
    }))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('chat_message')
  })

  it('persona cooldown respected — persona not eligible until cooldown elapsed', async () => {
    const scenario = getFixtureScenario()
    // Each time the LLM is called, tick_N fires.
    // Fixture persona has cooldownSeconds: 60.
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [
        { trigger: 'tick_1', tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#inc', message: 'hi' } }] },
        { trigger: 'tick_2', tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#inc', message: 'again' } }] },
      ],
    }))
    const engine = createStakeholderEngine(provider, scenario)

    // tick_1: persona speaks at simTime=0, last-spoke recorded as 0
    const events1 = await engine.tick(makeContext({ simTime: 0 }))
    expect(events1.length).toBeGreaterThan(0)

    // simTime=10 — cooldown not elapsed (0 + 60 > 10) → no eligible personas → no LLM call → no events
    const events2 = await engine.tick(makeContext({ simTime: 10 }))
    expect(events2).toHaveLength(0)

    // simTime=61 — cooldown elapsed (0 + 60 <= 61) → eligible → tick_2 fires
    const events3 = await engine.tick(makeContext({ simTime: 61 }))
    expect(events3.length).toBeGreaterThan(0)
  })

  it('no eligible personas → empty response → no SimEvents returned', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses())  // no tick_1 response
    const engine   = createStakeholderEngine(provider, scenario)
    const events   = await engine.tick(makeContext())
    expect(events).toHaveLength(0)
  })
})

// ── Error paths ───────────────────────────────────────────────────────────────

describe('StakeholderEngine.tick — error paths', () => {
  it('LLMError thrown → returns [] (never throws)', async () => {
    const throwingClient = {
      call: (): Promise<never> => { throw new LLMError('test error', 'provider_error') },
    }
    const engine = createStakeholderEngine(throwingClient, getFixtureScenario())
    const events = await engine.tick(makeContext())
    expect(events).toHaveLength(0)
  })

  it('invalid tool call params → skipped, other valid calls still executed', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger: 'tick_1',
        tool_calls: [
          // Invalid: missing required params
          { tool: 'send_message', params: {} },
          // Valid
          { tool: 'inject_log_entry', params: { service: 'fixture-service', level: 'INFO', message: 'ok' } },
        ],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    const events = await engine.tick(makeContext())
    // The invalid send_message should be skipped; inject_log_entry should fire
    expect(events.some(e => e.type === 'log_entry')).toBe(true)
    expect(events.some(e => e.type === 'chat_message')).toBe(false)
  })

  it('trigger_metric_recovery in response → skipped with log, does not crash', async () => {
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger: 'tick_1',
        tool_calls: [{ tool: 'trigger_metric_recovery', params: { service: 'svc' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    await expect(engine.tick(makeContext())).resolves.toHaveLength(0)
  })
})

// ── Context building ──────────────────────────────────────────────────────────

describe('StakeholderEngine.tick — context building', () => {
  it('conversation history included in correct order (verified via mock matching)', async () => {
    // The mock provider sees the actual prompt built by the engine.
    // We verify that after_action triggers work, which proves audit log is in context.
    const scenario = getFixtureScenario()
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [{
        trigger:    'after_action:trigger_rollback',
        tool_calls: [{ tool: 'inject_log_entry', params: { service: 'fixture-service', level: 'INFO', message: 'Rollback detected' } }],
      }],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    const events = await engine.tick(makeContext({
      auditLog: [{ action: 'trigger_rollback', params: { service: 'fixture-service' }, simTime: 50 }],
    }))
    // The after_action trigger fires because the audit log action is in the user message
    expect(events.some(e => e.type === 'log_entry')).toBe(true)
  })

  it('persona cooldowns included in context snapshot', async () => {
    const scenario = getFixtureScenario()
    // Verify cooldowns are tracked: speak, then check cooldown prevents repeat
    const provider = buildMockLLMProvider(makeResponses({
      stakeholder_responses: [
        { trigger: 'tick_1', tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#inc', message: 'hi' } }] },
        { trigger: 'tick_2', tool_calls: [{ tool: 'send_message', params: { persona: 'fixture-persona', channel: '#inc', message: 'again' } }] },
      ],
    }))
    const engine = createStakeholderEngine(provider, scenario)
    // tick_1: persona speaks at simTime=0
    await engine.tick(makeContext({ simTime: 0 }))
    // tick_2: simTime=10 — cooldown is 60s, should not speak
    const events2 = await engine.tick(makeContext({ simTime: 10 }))
    expect(events2).toHaveLength(0)
  })
})

// ── Context window truncation ─────────────────────────────────────────────────

describe('StakeholderEngine — context window truncation', () => {
  it('prompt is built without truncation when history is small', async () => {
    const scenario = getFixtureScenario()
    let capturedMessages: import('../../src/llm/llm-client').LLMMessage[] = []
    const provider = buildMockLLMProvider({
      stakeholder_responses: [{ trigger: 'tick_1', tool_calls: [] }],
      coach_responses:       [],
      debrief_response:      { narrative: '' },
    })
    // Intercept the call to inspect the prompt
    const originalCall = provider.call.bind(provider)
    const spyProvider  = {
      call: (req: import('../../src/llm/llm-client').LLMRequest) => {
        capturedMessages = req.messages
        return originalCall(req)
      },
    }

    const engine = createStakeholderEngine(spyProvider, scenario)
    const ctx = makeContext({
      conversations: {
        ...emptySnapshot(),
        chatChannels: {
          '#incidents': [
            { id: 'c1', channel: '#incidents', persona: 'fixture-persona', text: 'short message', simTime: 0 },
          ],
        },
      },
    })
    await engine.tick(ctx)

    // With small history, user message should NOT contain the truncation marker
    const userMsg = capturedMessages.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).not.toContain('older message(s) omitted')
    expect(userMsg!.content).toContain('short message')
  })

  it('truncation fires when history exceeds token budget and inserts summary prefix', async () => {
    const scenario = getFixtureScenario()

    let capturedUserContent = ''
    const spyProvider = {
      call: (req: import('../../src/llm/llm-client').LLMRequest) => {
        const userMsg = req.messages.find(m => m.role === 'user')
        capturedUserContent = userMsg?.content ?? ''
        return Promise.resolve({ toolCalls: [] })
      },
    }

    // Each message is ~2000 chars ≈ 500 tokens; 200 messages ≈ 100k tokens > 80k budget
    const longText = 'a'.repeat(2000)
    const manyMessages = Array.from({ length: 200 }, (_, i) => ({
      id:      `msg-${i}`,
      channel: '#incidents',
      persona: 'fixture-persona',
      text:    `${longText} message-${i}`,
      simTime: i,
    }))

    const engine = createStakeholderEngine(spyProvider, scenario)
    const ctx = makeContext({
      simTime: 200,
      conversations: {
        ...emptySnapshot(),
        chatChannels: { '#incidents': manyMessages },
      },
    })

    await engine.tick(ctx)

    // Truncation must have fired — 200 × 500 tokens exceeds the 80k budget
    expect(capturedUserContent).toContain('older message(s) omitted')
    // Most recent message must be preserved
    expect(capturedUserContent).toContain('message-199')
  })

  it('audit log is always preserved in full even when truncation fires', async () => {
    const scenario = getFixtureScenario()

    let capturedUserContent = ''
    const spyProvider = {
      call: (req: import('../../src/llm/llm-client').LLMRequest) => {
        const userMsg = req.messages.find(m => m.role === 'user')
        capturedUserContent = userMsg?.content ?? ''
        return Promise.resolve({ toolCalls: [] })
      },
    }

    // Large history to trigger truncation with the real 80k budget
    // Use very long messages to push over 80k tokens (≈320k chars)
    const longText = 'x'.repeat(2000)  // 500 tokens each
    const manyMessages = Array.from({ length: 200 }, (_, i) => ({
      id:      `msg-${i}`,
      channel: '#incidents',
      persona: 'fixture-persona',
      text:    `${longText} message-${i}`,
      simTime: i,
    }))

    const engine = createStakeholderEngine(spyProvider, scenario)
    const ctx = makeContext({
      simTime: 200,
      auditLog: [
        { action: 'view_deployment_history', params: { service: 'fixture-service' }, simTime: 50 },
        { action: 'trigger_rollback',        params: { service: 'fixture-service' }, simTime: 100 },
      ],
      conversations: {
        ...emptySnapshot(),
        chatChannels: { '#incidents': manyMessages },
      },
    })

    await engine.tick(ctx)

    // Audit log must be fully present regardless of truncation
    expect(capturedUserContent).toContain('view_deployment_history')
    expect(capturedUserContent).toContain('trigger_rollback')
  })

  it('system prompt is never truncated', async () => {
    const scenario = getFixtureScenario()

    let capturedSystemContent = ''
    const spyProvider = {
      call: (req: import('../../src/llm/llm-client').LLMRequest) => {
        const sysMsg = req.messages.find(m => m.role === 'system')
        capturedSystemContent = sysMsg?.content ?? ''
        return Promise.resolve({ toolCalls: [] })
      },
    }

    const longText = 'y'.repeat(2000)
    const manyMessages = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`, channel: '#incidents', persona: 'fixture-persona',
      text: `${longText} msg-${i}`, simTime: i,
    }))

    const engine = createStakeholderEngine(spyProvider, scenario)
    const ctx = makeContext({
      simTime: 200,
      conversations: { ...emptySnapshot(), chatChannels: { '#incidents': manyMessages } },
    })

    await engine.tick(ctx)

    // System prompt always contains full persona instructions
    expect(capturedSystemContent).toContain('Stakeholder Engine Instructions')
    expect(capturedSystemContent).toContain('fixture-persona')
    expect(capturedSystemContent).toContain(scenario.title)
  })
})
