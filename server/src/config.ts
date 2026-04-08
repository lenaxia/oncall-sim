// config.ts — env var loading and validation.
// Throws a descriptive Error if required vars are missing so main() can exit cleanly.

export interface AppConfig {
  port:          number
  scenariosDir:  string
  llmProvider:   'openai' | 'bedrock'
  mockLLM:       boolean
  openai: {
    apiKey:  string
    baseUrl: string
    model:   string
  }
  bedrock: {
    region:  string
    modelId: string
  }
  llm: {
    timeoutMs:  number
    maxRetries: number
  }
  sessionExpiryMs: number
}

export function loadConfig(): AppConfig {
  const mockLLM    = process.env.MOCK_LLM === 'true'
  const provider   = (process.env.LLM_PROVIDER ?? 'openai') as 'openai' | 'bedrock'

  if (!mockLLM) {
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
      throw new Error('[config] OPENAI_API_KEY is required when LLM_PROVIDER=openai')
    }
    if (provider === 'bedrock' && !process.env.BEDROCK_MODEL_ID) {
      throw new Error('[config] BEDROCK_MODEL_ID is required when LLM_PROVIDER=bedrock')
    }
    if (provider !== 'openai' && provider !== 'bedrock') {
      throw new Error(`[config] Unknown LLM_PROVIDER: '${String(provider)}'. Valid: openai, bedrock`)
    }
  }

  return {
    port:         parseInt(process.env.PORT ?? '3001', 10),
    scenariosDir: process.env.SCENARIOS_DIR ?? '../scenarios',
    llmProvider:  provider,
    mockLLM,
    openai: {
      apiKey:  process.env.OPENAI_API_KEY  ?? '',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model:   process.env.OPENAI_MODEL    ?? 'gpt-4o',
    },
    bedrock: {
      region:  process.env.AWS_REGION       ?? 'us-east-1',
      modelId: process.env.BEDROCK_MODEL_ID ?? '',
    },
    llm: {
      timeoutMs:  parseInt(process.env.LLM_TIMEOUT_MS  ?? '30000', 10),
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '2',     10),
    },
    sessionExpiryMs: parseInt(process.env.SESSION_EXPIRY_MS ?? '600000', 10),
  }
}
