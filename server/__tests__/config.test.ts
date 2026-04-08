import { describe, it, expect, afterEach } from 'vitest'
import { loadConfig } from '../src/config'

// Save and restore env vars around each test
const PRESERVED = [
  'MOCK_LLM', 'LLM_PROVIDER',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'BEDROCK_MODEL_ID', 'AWS_REGION',
  'PORT', 'SCENARIOS_DIR',
  'LLM_TIMEOUT_MS', 'LLM_MAX_RETRIES', 'SESSION_EXPIRY_MS',
]
let _saved: Record<string, string | undefined> = {}

function saveEnv() {
  _saved = {}
  for (const key of PRESERVED) _saved[key] = process.env[key]
}

function restoreEnv() {
  for (const key of PRESERVED) {
    if (_saved[key] === undefined) delete process.env[key]
    else process.env[key] = _saved[key]
  }
}

afterEach(() => restoreEnv())

// ── MOCK_LLM=true bypasses all LLM env var checks ────────────────────────────

describe('loadConfig — mock mode', () => {
  it('MOCK_LLM=true → succeeds without any LLM env vars', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.OPENAI_API_KEY
    delete process.env.BEDROCK_MODEL_ID

    expect(() => loadConfig()).not.toThrow()
  })

  it('MOCK_LLM=true → mockLLM is true in config', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'

    const config = loadConfig()
    expect(config.mockLLM).toBe(true)
  })

  it('MOCK_LLM=false or unset → mockLLM is false', () => {
    saveEnv()
    process.env.MOCK_LLM     = 'false'
    process.env.LLM_PROVIDER  = 'openai'
    process.env.OPENAI_API_KEY = 'test-key'

    const config = loadConfig()
    expect(config.mockLLM).toBe(false)
  })
})

// ── Missing required env vars throw with clear messages ───────────────────────

describe('loadConfig — missing required env vars', () => {
  it('LLM_PROVIDER=openai without OPENAI_API_KEY → throws with clear message', () => {
    saveEnv()
    process.env.MOCK_LLM    = 'false'
    process.env.LLM_PROVIDER = 'openai'
    delete process.env.OPENAI_API_KEY

    expect(() => loadConfig()).toThrow(/OPENAI_API_KEY/)
  })

  it('LLM_PROVIDER=bedrock without BEDROCK_MODEL_ID → throws with clear message', () => {
    saveEnv()
    process.env.MOCK_LLM    = 'false'
    process.env.LLM_PROVIDER = 'bedrock'
    delete process.env.BEDROCK_MODEL_ID

    expect(() => loadConfig()).toThrow(/BEDROCK_MODEL_ID/)
  })

  it('unknown LLM_PROVIDER → throws with clear message including the bad value', () => {
    saveEnv()
    process.env.MOCK_LLM    = 'false'
    process.env.LLM_PROVIDER = 'unknown-provider'

    expect(() => loadConfig()).toThrow(/unknown-provider/)
  })
})

// ── Default values ─────────────────────────────────────────────────────────────

describe('loadConfig — defaults', () => {
  it('PORT defaults to 3001', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.PORT

    expect(loadConfig().port).toBe(3001)
  })

  it('SCENARIOS_DIR defaults to ../scenarios', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.SCENARIOS_DIR

    expect(loadConfig().scenariosDir).toBe('../scenarios')
  })

  it('SESSION_EXPIRY_MS defaults to 600000', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.SESSION_EXPIRY_MS

    expect(loadConfig().sessionExpiryMs).toBe(600_000)
  })

  it('LLM_TIMEOUT_MS defaults to 30000', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.LLM_TIMEOUT_MS

    expect(loadConfig().llm.timeoutMs).toBe(30_000)
  })

  it('LLM_MAX_RETRIES defaults to 2', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    delete process.env.LLM_MAX_RETRIES

    expect(loadConfig().llm.maxRetries).toBe(2)
  })
})

// ── Env var overrides ──────────────────────────────────────────────────────────

describe('loadConfig — env var overrides', () => {
  it('PORT env var is respected', () => {
    saveEnv()
    process.env.MOCK_LLM = 'true'
    process.env.PORT      = '8080'

    expect(loadConfig().port).toBe(8080)
  })

  it('SESSION_EXPIRY_MS env var is respected', () => {
    saveEnv()
    process.env.MOCK_LLM          = 'true'
    process.env.SESSION_EXPIRY_MS  = '300000'

    expect(loadConfig().sessionExpiryMs).toBe(300_000)
  })

  it('OPENAI config values are captured', () => {
    saveEnv()
    process.env.MOCK_LLM        = 'false'
    process.env.LLM_PROVIDER     = 'openai'
    process.env.OPENAI_API_KEY   = 'sk-test'
    process.env.OPENAI_BASE_URL  = 'https://custom.endpoint/v1'
    process.env.OPENAI_MODEL     = 'gpt-4-turbo'

    const config = loadConfig()
    expect(config.openai.apiKey).toBe('sk-test')
    expect(config.openai.baseUrl).toBe('https://custom.endpoint/v1')
    expect(config.openai.model).toBe('gpt-4-turbo')
  })

  it('Bedrock config values are captured', () => {
    saveEnv()
    process.env.MOCK_LLM          = 'false'
    process.env.LLM_PROVIDER       = 'bedrock'
    process.env.BEDROCK_MODEL_ID   = 'anthropic.claude-3-sonnet'
    process.env.AWS_REGION         = 'us-west-2'

    const config = loadConfig()
    expect(config.bedrock.modelId).toBe('anthropic.claude-3-sonnet')
    expect(config.bedrock.region).toBe('us-west-2')
  })
})
