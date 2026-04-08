// llm-client.ts — provider-agnostic LLM abstraction interface, types, and factory.

import { MockProvider, loadMockResponses } from './mock-provider.js'
import { OpenAIProvider } from './openai-provider.js'
import { BedrockProvider } from './bedrock-provider.js'
import path from 'path'

export interface LLMClient {
  call(request: LLMRequest): Promise<LLMResponse>
}

export interface LLMRequest {
  role:      LLMRole
  messages:  LLMMessage[]
  tools:     LLMToolDefinition[]
  sessionId: string
}

export interface LLMResponse {
  toolCalls: LLMToolCall[]
  text?:     string
}

export interface LLMMessage {
  role:    'system' | 'user' | 'assistant'
  content: string
}

export interface LLMToolCall {
  tool:   string
  params: Record<string, unknown>
}

export interface LLMToolDefinition {
  name:        string
  description: string
  parameters:  Record<string, unknown>  // JSON Schema
}

export type LLMRole = 'stakeholder' | 'coach' | 'debrief'

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: 'timeout' | 'rate_limit' | 'invalid_response' | 'provider_error'
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

/**
 * Factory — reads env vars, returns the appropriate LLMClient.
 * MOCK_LLM=true         → MockProvider (reads _fixture/mock-llm-responses.yaml from SCENARIOS_DIR)
 * LLM_PROVIDER=openai   → OpenAIProvider (requires OPENAI_API_KEY)
 * LLM_PROVIDER=bedrock  → BedrockProvider (requires BEDROCK_MODEL_ID; AWS SDK lazy-loaded inside)
 */
export function createLLMClient(): LLMClient {
  if (process.env.MOCK_LLM === 'true') {
    const scenariosDir = path.resolve(process.env.SCENARIOS_DIR ?? '../scenarios')
    const fixtureDir   = path.join(scenariosDir, '_fixture')
    return new MockProvider(loadMockResponses(fixtureDir))
  }

  const provider = process.env.LLM_PROVIDER ?? 'openai'

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('[createLLMClient] OPENAI_API_KEY is required when LLM_PROVIDER=openai')
    return new OpenAIProvider({
      apiKey,
      baseUrl:    process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model:      process.env.OPENAI_MODEL    ?? 'gpt-4o',
      timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS  ?? '30000', 10),
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '2',     10),
    })
  }

  if (provider === 'bedrock') {
    const modelId = process.env.BEDROCK_MODEL_ID
    if (!modelId) throw new Error('[createLLMClient] BEDROCK_MODEL_ID is required when LLM_PROVIDER=bedrock')
    return new BedrockProvider({
      region:     process.env.AWS_REGION       ?? 'us-east-1',
      modelId,
      timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS  ?? '30000', 10),
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '2',     10),
    })
  }

  throw new Error(`[createLLMClient] Unknown LLM_PROVIDER: '${provider}'. Valid values: openai, bedrock`)
}
