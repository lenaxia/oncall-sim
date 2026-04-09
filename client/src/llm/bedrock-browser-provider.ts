// bedrock-browser-provider.ts — Harmony-mode Bedrock provider.
// Uses window.harmony.authorization.assume() for STS credentials.
// Auto-refreshes credentials 5 minutes before expiry.
// Only instantiated when VITE_LLM_MODE=harmony.
// Imported dynamically in llm-client.ts factory to keep @aws-sdk out of non-harmony builds.

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message,
  type Tool,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
} from "./llm-client";
import { LLMError } from "./llm-client";

interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

interface BedrockBrowserConfig {
  roleArn: string;
  region: string;
  modelId: string;
}

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

export class BedrockBrowserProvider implements LLMClient {
  private _credentials: BedrockCredentials | null = null;
  private _client: BedrockRuntimeClient | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: BedrockBrowserConfig) {}

  async call(request: LLMRequest): Promise<LLMResponse> {
    const client = await this._getClient();

    const messages: Message[] = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: [{ text: m.content }],
      }));

    const systemPrompt = request.messages.find(
      (m) => m.role === "system",
    )?.content;

    const tools: Tool[] | undefined =
      request.tools.length > 0
        ? request.tools.map((t) => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.parameters } as ToolInputSchema,
            },
          }))
        : undefined;

    try {
      const command = new ConverseCommand({
        modelId: this.config.modelId,
        messages,
        system: systemPrompt ? [{ text: systemPrompt }] : undefined,
        toolConfig: tools ? { tools } : undefined,
      });

      const response: ConverseCommandOutput = await client.send(command);
      return this._parseResponse(response);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === "ThrottlingException")
          throw new LLMError(err.message, "rate_limit");
        if (err.name === "ValidationException")
          throw new LLMError(err.message, "invalid_response");
      }
      throw new LLMError(`Bedrock error: ${String(err)}`, "provider_error");
    }
  }

  private async _getClient(): Promise<BedrockRuntimeClient> {
    if (this._client && this._credentials && !this._isExpiringSoon()) {
      return this._client;
    }
    await this._refreshCredentials();
    return this._client!;
  }

  private _isExpiringSoon(): boolean {
    if (!this._credentials) return true;
    return (
      this._credentials.expiration.getTime() - Date.now() <
      REFRESH_BEFORE_EXPIRY_MS
    );
  }

  private async _refreshCredentials(): Promise<void> {
    if (!window.harmony?.authorization) {
      throw new LLMError(
        "window.harmony.authorization not available — not running in Harmony?",
        "provider_error",
      );
    }
    const creds = await window.harmony.authorization.assume(
      this.config.roleArn,
    );
    this._credentials = creds;
    this._client = new BedrockRuntimeClient({
      region: this.config.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });

    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const refreshAt =
      creds.expiration.getTime() - Date.now() - REFRESH_BEFORE_EXPIRY_MS;
    if (refreshAt > 0) {
      this._refreshTimer = setTimeout(() => {
        void this._refreshCredentials();
      }, refreshAt);
    }
  }

  private _parseResponse(response: ConverseCommandOutput): LLMResponse {
    const output = response.output?.message;
    if (!output)
      throw new LLMError("Empty response from Bedrock", "invalid_response");

    const toolCalls: LLMToolCall[] = [];
    let text: string | undefined;

    for (const block of output.content ?? []) {
      // Use discriminated union narrowing instead of casts
      if ("text" in block && typeof block.text === "string") {
        text = block.text;
      } else if ("toolUse" in block && block.toolUse) {
        toolCalls.push({
          tool: block.toolUse.name ?? "",
          params: (block.toolUse.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return { toolCalls, text };
  }
}
