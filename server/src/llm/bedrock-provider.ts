// bedrock-provider.ts — AWS Bedrock LLM provider using the Converse API.

import type { LLMClient, LLMRequest, LLMResponse, LLMToolCall } from './llm-client'
import { LLMError } from './llm-client'

interface BedrockConfig {
  region:     string
  modelId:    string
  profile?:   string   // AWS named profile — uses default credential chain if omitted
  timeoutMs:  number
  maxRetries: number
}

export class BedrockProvider implements LLMClient {
  constructor(private config: BedrockConfig) {}

  async call(request: LLMRequest): Promise<LLMResponse> {
    let BedrockRuntimeClient: BedrockRuntimeClientType
    let ConverseCommand: ConverseCommandType
    try {
      const sdk = await import('@aws-sdk/client-bedrock-runtime') as AWSBedrockModule
      BedrockRuntimeClient = sdk.BedrockRuntimeClient
      ConverseCommand       = sdk.ConverseCommand
    } catch {
      throw new LLMError('@aws-sdk/client-bedrock-runtime is not installed.', 'provider_error')
    }

    // Explicit profile -> fromIni; otherwise default SDK credential chain
    let credentials: unknown
    if (this.config.profile) {
      try {
        const { fromIni } = await import('@aws-sdk/credential-providers')
        credentials = fromIni({ profile: this.config.profile })
      } catch {
        throw new LLMError('@aws-sdk/credential-providers not installed.', 'provider_error')
      }
    }

    const clientConfig: Record<string, unknown> = { region: this.config.region }
    if (credentials) clientConfig.credentials = credentials
    const client = new BedrockRuntimeClient(clientConfig)

    const messages = request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role:    m.role as 'user' | 'assistant',
        content: [{ text: m.content }],
      }))

    const system = request.messages
      .filter(m => m.role === 'system')
      .map(m => ({ text: m.content }))

    const toolConfig = request.tools.length > 0 ? {
      tools: request.tools.map(t => ({
        toolSpec: {
          name:        t.name,
          description: t.description,
          inputSchema: { json: t.parameters },
        },
      })),
    } : undefined

    const input = {
      modelId:    this.config.modelId,
      system:     system.length > 0 ? system : undefined,
      messages,
      toolConfig,
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await Promise.race([
          client.send(new ConverseCommand(input)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new LLMError('Request timed out', 'timeout')), this.config.timeoutMs)
          ),
        ])
        return this._parseResponse(response as BedrockConverseResponse)
      } catch (err: unknown) {
        if (err instanceof LLMError) {
          if (err.code === 'timeout') throw err
        }

        const errAny = err as { name?: string; $metadata?: { httpStatusCode?: number } }

        if (errAny.name === 'ThrottlingException' || errAny.$metadata?.httpStatusCode === 429) {
          await this._sleep(2000 * 2 ** attempt)
          attempt--
          continue
        }

        if (attempt < this.config.maxRetries) {
          await this._sleep(500 * 2 ** attempt)
          continue
        }

        throw new LLMError(`Bedrock error: ${String(err)}`, 'provider_error')
      }
    }

    throw new LLMError('Max retries exceeded', 'provider_error')
  }

  private _parseResponse(response: BedrockConverseResponse): LLMResponse {
    const output = response.output?.message
    if (!output) return { toolCalls: [] }

    const toolCalls: LLMToolCall[] = []
    let text: string | undefined

    for (const block of output.content ?? []) {
      if (block.text != null) text = block.text
      if (block.toolUse != null) {
        toolCalls.push({
          tool:   block.toolUse.name,
          params: block.toolUse.input ?? {},
        })
      }
    }

    return { toolCalls, text }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ── AWS SDK type stubs ────────────────────────────────────────────────────────

type BedrockRuntimeClientType = new (cfg: Record<string, unknown>) => {
  send(cmd: unknown): Promise<unknown>
}
type ConverseCommandType = new (input: unknown) => unknown

interface AWSBedrockModule {
  BedrockRuntimeClient: BedrockRuntimeClientType
  ConverseCommand:       ConverseCommandType
}

interface BedrockConverseResponse {
  output?: {
    message?: {
      content?: Array<{
        text?:    string
        toolUse?: { name: string; input?: Record<string, unknown> }
      }>
    }
  }
}
