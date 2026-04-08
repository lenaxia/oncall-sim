import { describe, it, expect } from 'vitest'
import { createLLMClient } from '../../src/llm/llm-client'

describe('createLLMClient', () => {
  it('MOCK_LLM=true → returns a working lazy mock client', async () => {
    // MOCK_LLM=true in test env (set in package.json test script)
    const client = createLLMClient()
    expect(client).toBeDefined()
    expect(typeof client.call).toBe('function')
    const response = await client.call({
      role:      'stakeholder',
      messages:  [{ role: 'user', content: 'test' }],
      tools:     [],
      sessionId: 'test-session',
    })
    expect(response).toBeDefined()
    expect(Array.isArray(response.toolCalls)).toBe(true)
  })

  it('LLM_PROVIDER=openai without OPENAI_API_KEY → throws synchronously with clear message', () => {
    const origMock     = process.env.MOCK_LLM
    const origKey      = process.env.OPENAI_API_KEY
    const origProvider = process.env.LLM_PROVIDER
    try {
      process.env.MOCK_LLM     = 'false'
      process.env.LLM_PROVIDER  = 'openai'
      delete process.env.OPENAI_API_KEY
      expect(() => createLLMClient()).toThrow(/OPENAI_API_KEY/)
    } finally {
      process.env.MOCK_LLM    = origMock
      process.env.LLM_PROVIDER = origProvider
      if (origKey) process.env.OPENAI_API_KEY = origKey
    }
  })

  it('LLM_PROVIDER=bedrock without BEDROCK_MODEL_ID → throws synchronously with clear message', () => {
    const origMock     = process.env.MOCK_LLM
    const origModel    = process.env.BEDROCK_MODEL_ID
    const origProvider = process.env.LLM_PROVIDER
    try {
      process.env.MOCK_LLM     = 'false'
      process.env.LLM_PROVIDER  = 'bedrock'
      delete process.env.BEDROCK_MODEL_ID
      expect(() => createLLMClient()).toThrow(/BEDROCK_MODEL_ID/)
    } finally {
      process.env.MOCK_LLM    = origMock
      process.env.LLM_PROVIDER = origProvider
      if (origModel) process.env.BEDROCK_MODEL_ID = origModel
    }
  })

  it('unknown LLM_PROVIDER → throws with clear message', () => {
    const origMock     = process.env.MOCK_LLM
    const origProvider = process.env.LLM_PROVIDER
    try {
      process.env.MOCK_LLM     = 'false'
      process.env.LLM_PROVIDER  = 'unknownprovider'
      expect(() => createLLMClient()).toThrow(/unknownprovider/)
    } finally {
      process.env.MOCK_LLM    = origMock
      process.env.LLM_PROVIDER = origProvider
    }
  })

  it('LLM_PROVIDER=openai WITH OPENAI_API_KEY → returns lazy client (no network call)', () => {
    const origMock     = process.env.MOCK_LLM
    const origProvider = process.env.LLM_PROVIDER
    try {
      process.env.MOCK_LLM     = 'false'
      process.env.LLM_PROVIDER  = 'openai'
      process.env.OPENAI_API_KEY = 'test-key'
      const client = createLLMClient()
      expect(client).toBeDefined()
      expect(typeof client.call).toBe('function')
    } finally {
      process.env.MOCK_LLM    = origMock
      process.env.LLM_PROVIDER = origProvider
    }
  })

  it('LLM_PROVIDER=bedrock WITH BEDROCK_MODEL_ID → returns lazy client (no network call)', () => {
    const origMock     = process.env.MOCK_LLM
    const origProvider = process.env.LLM_PROVIDER
    try {
      process.env.MOCK_LLM       = 'false'
      process.env.LLM_PROVIDER    = 'bedrock'
      process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'
      const client = createLLMClient()
      expect(client).toBeDefined()
      expect(typeof client.call).toBe('function')
    } finally {
      process.env.MOCK_LLM    = origMock
      process.env.LLM_PROVIDER = origProvider
    }
  })
})
