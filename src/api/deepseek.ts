import OpenAI from "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ClientConfig {
  base_url: string;
  key: string;
  model: string;
}

export interface ChatOptions {
  model?: string;
  reasoning_effort?: "low" | "medium" | "high" | "max";
  temperature?: number;
  max_tokens?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cache_hit_tokens: number;
  cache_miss_tokens: number;
  total_cost_estimate: number;
}

export type ChatStreamChunk =
  | { type: "chunk"; content: string }
  | { type: "done"; usage: ChatUsage; model: string };

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

const COST_PER_MILLION: Record<string, { cache_hit: number; cache_miss: number; output: number }> = {
  "deepseek-v4-flash": { cache_hit: 0.008, cache_miss: 0.14, output: 0.28 },
  "deepseek-v4-pro": { cache_hit: 0.02, cache_miss: 0.42, output: 0.84 },
};

const DEFAULT_COST = COST_PER_MILLION["deepseek-v4-flash"]!;

function calculateCost(usage: ChatUsage, model: string): number {
  const costs = COST_PER_MILLION[model] ?? DEFAULT_COST;
  const hitCost = (usage.cache_hit_tokens / 1_000_000) * costs.cache_hit;
  const missCost = (usage.cache_miss_tokens / 1_000_000) * costs.cache_miss;
  const outputCost = (usage.completion_tokens / 1_000_000) * costs.output;
  return hitCost + missCost + outputCost;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeepSeekClient {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: ClientConfig) {
    this.client = new OpenAI({
      baseURL: config.base_url,
      apiKey: config.key,
      timeout: 120_000,
    });
    this.defaultModel = config.model;
  }

  private shouldRetry(statusCode: number): boolean {
    return RETRYABLE_STATUS_CODES.has(statusCode);
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<ChatStreamChunk> {
    const model = options?.model ?? this.defaultModel;
    const reasoningEffort = options?.reasoning_effort;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let hasYielded = false;
      try {
        const requestBody: Record<string, unknown> = {
          model,
          messages,
          stream: true,
          temperature: options?.temperature,
          max_tokens: options?.max_tokens,
        };

        if (reasoningEffort) {
          requestBody.reasoning_effort = reasoningEffort;
        }

        const stream = await this.client.chat.completions.create(
          requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming
        );

        let promptTokens = 0;
        let completionTokens = 0;
        let cacheHitTokens = 0;
        let responseModel = model;

        for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
          if (chunk.choices?.[0]?.delta?.content) {
            const content = chunk.choices[0].delta.content;
            hasYielded = true;
            yield { type: "chunk", content };
          }

          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0;
            completionTokens = chunk.usage.completion_tokens ?? 0;
            cacheHitTokens =
              ((chunk.usage as unknown as Record<string, number>).prompt_cache_hit_tokens) ?? 0;
          }

          if (chunk.model) {
            responseModel = chunk.model;
          }
        }

        const cacheMissTokens = promptTokens - cacheHitTokens;
        const usage: ChatUsage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          cache_hit_tokens: cacheHitTokens,
          cache_miss_tokens: cacheMissTokens,
          total_cost_estimate: 0,
        };
        usage.total_cost_estimate = calculateCost(usage, responseModel);

        yield { type: "done", usage, model: responseModel };
        return;
      } catch (error: unknown) {
        lastError = error as Error;

        if (hasYielded) throw error;

        if (error instanceof OpenAI.APIError) {
          const statusCode = error.status;

          if (statusCode && this.shouldRetry(statusCode) && attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await sleep(delay);
            continue;
          }
        }

        throw error;
      }
    }

    throw lastError;
  }

  async collect(messages: ChatMessage[], maxTokens = 2048): Promise<string> {
    let result = "";
    for await (const chunk of this.chat(messages, { max_tokens: maxTokens })) {
      if (chunk.type === "chunk") {
        result += chunk.content;
      }
    }
    return result;
  }
}
