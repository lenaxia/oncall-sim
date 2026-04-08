// mock-provider.ts — deterministic mock LLM for tests and MOCK_LLM=true dev mode.
// Fulfills the MockLLMProvider / MockLLMResponses forward references from Phase 1.

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { LLMClient, LLMRequest, LLMResponse } from './llm-client'

// ── Public types ──────────────────────────────────────────────────────────────

export interface MockStakeholderResponse {
  trigger:    string
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>
}

export interface MockCoachResponse {
  trigger:  string
  message:  string
}

export interface MockLLMResponses {
  stakeholder_responses: MockStakeholderResponse[]
  coach_responses:       MockCoachResponse[]
  debrief_response:      { narrative: string }
}

export type MockLLMProvider = MockProvider

// ── MockProvider ──────────────────────────────────────────────────────────────

export class MockProvider implements LLMClient {
  private _tickCount = 0

  constructor(private responses: MockLLMResponses) {}

  call(request: LLMRequest): Promise<LLMResponse> {
    if (request.role === 'debrief') {
      return Promise.resolve({
        toolCalls: [],
        text:      this.responses.debrief_response?.narrative ?? '',
      })
    }

    if (request.role === 'coach') {
      return Promise.resolve(this._matchCoach(request))
    }

    // stakeholder role
    return Promise.resolve(this._matchStakeholder(request))
  }

  private _matchStakeholder(request: LLMRequest): LLMResponse {
    this._tickCount++
    const tickTrigger = `tick_${this._tickCount}`

    // Try tick_N trigger
    const tickMatch = this.responses.stakeholder_responses?.find(r => r.trigger === tickTrigger)
    if (tickMatch) return this._toResponse(tickMatch.tool_calls)

    // Try after_action:<type>:<optional_param> triggers
    // Check all user messages for action mentions (audit log format: "[t=N] action_type {...}")
    const allUserContent = (request.messages ?? [])
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n')

    for (const sr of this.responses.stakeholder_responses ?? []) {
      if (!sr.trigger.startsWith('after_action:')) continue
      const parts       = sr.trigger.split(':')
      const actionType  = parts[1]
      const actionParam = parts[2] ?? ''

      const actionFound = allUserContent.includes(actionType)
      const paramFound  = !actionParam || allUserContent.includes(actionParam)

      if (actionFound && paramFound) {
        return this._toResponse(sr.tool_calls)
      }
    }

    return { toolCalls: [] }
  }

  private _matchCoach(request: LLMRequest): LLMResponse {
    // on_demand: triggered when role=coach and messages suggest a trainee question
    const lastUserMsg = [...(request.messages ?? [])]
      .reverse()
      .find(m => m.role === 'user')
    const isOnDemand = lastUserMsg?.content.includes('trainee asks') ||
                       lastUserMsg?.content.includes('on_demand')
    if (isOnDemand) {
      const match = this.responses.coach_responses?.find(r => r.trigger === 'on_demand')
      if (match) return { toolCalls: [], text: match.message }
    }

    // proactive_tick_N
    this._tickCount++
    const trigger = `proactive_tick_${this._tickCount}`
    const match = this.responses.coach_responses?.find(r => r.trigger === trigger)
    if (match) return { toolCalls: [], text: match.message }

    return { toolCalls: [] }
  }

  private _toResponse(
    toolCalls: Array<{ tool: string; params: Record<string, unknown> }>
  ): LLMResponse {
    return {
      toolCalls: toolCalls.map(tc => ({ tool: tc.tool, params: tc.params ?? {} })),
    }
  }
}

// ── File loading ──────────────────────────────────────────────────────────────

export function loadMockResponses(scenarioDir: string): MockLLMResponses {
  const filePath = path.join(scenarioDir, 'mock-llm-responses.yaml')
  const content  = fs.readFileSync(filePath, 'utf8')
  const parsed   = yaml.load(content) as MockLLMResponses
  return {
    stakeholder_responses: parsed.stakeholder_responses ?? [],
    coach_responses:       parsed.coach_responses       ?? [],
    debrief_response:      parsed.debrief_response      ?? { narrative: '' },
  }
}

/**
 * Creates a MockProvider using SCENARIOS_DIR env var to locate mock-llm-responses.yaml.
 * Falls back to '../scenarios' if SCENARIOS_DIR is not set.
 * Used by createLLMClient() when MOCK_LLM=true.
 */
export function createMockClientFromEnv(): LLMClient {
  const scenariosDir = path.resolve(process.env.SCENARIOS_DIR ?? '../scenarios')
  const fixtureDir   = path.join(scenariosDir, '_fixture')
  const responses    = loadMockResponses(fixtureDir)
  return new MockProvider(responses)
}
