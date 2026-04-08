// openai-provider.ts — OpenAI-compatible LLM provider with retry and backoff.

import type { LLMClient, LLMRequest, LLMResponse, LLMToolCall } from './llm-client'
import { LLMError } from './llm-client'

interface OpenAIConfig {
  apiKey:     string
  baseUrl:    string
  model:      string
  timeoutMs:  number
  maxRetries: number
}

export class OpenAIProvider implements LLMClient {
  constructor(private config: OpenAIConfig) {}

  async call(request: LLMRequest): Promise<LLMResponse> {
    const body = this._buildRequestBody(request)

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let resp: Response
      try {
        const controller = new AbortController()
        const timeoutId  = setTimeout(() => controller.abort(), this.config.timeoutMs)
        try {
          resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body:    JSON.stringify(body),
            signal:  controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new LLMError('Request timed out', 'timeout')
        }
        if (attempt < this.config.maxRetries) {
          await this._sleep(500 * 2 ** attempt)
          continue
        }
        throw new LLMError(`Network error: ${String(err)}`, 'provider_error')
      }

      // 429 rate limit — exponential backoff, doesn't count as retry
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get('retry-after') ?? 1)
        await this._sleep(retryAfter * 1000)
        attempt--   // don't count this attempt
        continue
      }

      // 4xx — don't retry
      if (resp.status >= 400 && resp.status < 500) {
        const text = await resp.text().catch(() => '')
        throw new LLMError(`Provider error ${resp.status}: ${text}`, 'provider_error')
      }

      // 5xx — retry
      if (resp.status >= 500) {
        if (attempt < this.config.maxRetries) {
          await this._sleep(500 * 2 ** attempt)
          continue
        }
        throw new LLMError(`Provider error ${resp.status}`, 'provider_error')
      }

      // Success
      const json = await resp.json() as OpenAIChatCompletion
      return this._parseResponse(json)
    }

    throw new LLMError('Max retries exceeded', 'provider_error')
  }

  private _buildRequestBody(request: LLMRequest): OpenAIChatRequest {
    const tools = request.tools.map(t => ({
      type:     'function' as const,
      function: {
        name:        t.name,
        description: t.description,
        parameters:  t.parameters,
      },
    }))

    return {
      model:    this.config.model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      tools:    tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    }
  }

  private _parseResponse(json: OpenAIChatCompletion): LLMResponse {
    const choice = json.choices?.[0]
    if (!choice) throw new LLMError('Empty choices in response', 'invalid_response')

    const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map(tc => {
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // malformed JSON — skip
      }
      return { tool: tc.function.name, params }
    })

    return {
      toolCalls,
      text: choice.message.content ?? undefined,
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ── OpenAI API response types ─────────────────────────────────────────────────

interface OpenAIChatRequest {
  model:        string
  messages:     Array<{ role: string; content: string }>
  tools?:       OpenAITool[]
  tool_choice?: 'auto' | 'none'
}

interface OpenAITool {
  type:     'function'
  function: {
    name:        string
    description: string
    parameters:  Record<string, unknown>
  }
}

interface OpenAIChatCompletion {
  choices: Array<{
    message: {
      content:    string | null
      tool_calls?: Array<{
        function: {
          name:      string
          arguments: string
        }
      }>
    }
  }>
}
