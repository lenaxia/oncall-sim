// llm-client.ts — provider-agnostic LLM abstraction interface, types, and factory.
// Phase C: complete with three-mode factory.

export interface LLMClient {
  call(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  role: LLMRole;
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  sessionId: string;
}

export interface LLMResponse {
  toolCalls: LLMToolCall[];
  text?: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LLMRole = "stakeholder" | "coach" | "debrief";

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "timeout"
      | "rate_limit"
      | "invalid_response"
      | "provider_error",
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/**
 * Factory — selects provider based on VITE_LLM_MODE and VITE_MOCK_LLM.
 *
 * VITE_MOCK_LLM=true or import.meta.env.MODE === 'test'
 *   → MockProvider (reads bundled fixture YAML)
 * VITE_LLM_MODE=local | k8s (default)
 *   → OpenAIProvider (calls VITE_LLM_BASE_URL/chat/completions)
 */
export async function createLLMClient(): Promise<LLMClient> {
  // Mock mode: unit tests or explicit VITE_MOCK_LLM=true
  if (
    import.meta.env.VITE_MOCK_LLM === "true" ||
    import.meta.env.MODE === "test"
  ) {
    const { createFixtureMockProvider } = await import("./mock-provider");
    return createFixtureMockProvider();
  }

  // local or k8s — both use OpenAIProvider
  const { OpenAIProvider } = await import("./openai-provider");
  const baseUrl =
    import.meta.env.VITE_LLM_BASE_URL ?? "https://ai.thekao.cloud/v1";
  const apiKey = import.meta.env.VITE_LLM_API_KEY ?? "";
  const model = import.meta.env.VITE_LLM_MODEL ?? "gpt-4o";

  return new OpenAIProvider({
    apiKey,
    baseUrl,
    model,
    timeoutMs: 30_000,
    maxRetries: 2,
  });
}
