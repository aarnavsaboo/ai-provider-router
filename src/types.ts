export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Protocol = "openai-compatible" | "ollama";

export type Provider = {
  name: string;
  endpoint: string;
  model: string;
  kind?: Protocol;
  apiKey?: string;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  outputTokenField?: "max_tokens" | "max_completion_tokens";
};

export type RouteRule = {
  when: (task: string) => boolean;
  provider: string;
  fallbacks?: string[];
};

export type ChatOptions = {
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
};

export type ModelOutput = {
  text: string;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number };
  finishReason?: string;
};

export type Completion = ModelOutput & {
  provider: string;
  attempts: number;
  latencyMs: number;
};

export type AttemptEvent = {
  provider: string;
  phase: "success" | "failure" | "skipped";
  attempt: number;
  latencyMs: number;
  code?: string;
};

export type RouterOptions = {
  fetch?: typeof globalThis.fetch;
  retryDelayMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
  onEvent?: (event: AttemptEvent) => void;
};

export type BatchInput = { task: string; messages: ChatMessage[]; options?: ChatOptions };
export type BatchResult = { ok: true; value: Completion } | { ok: false; error: Error };

export class ModelError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: "http" | "timeout" | "network" | "invalid-response" | "aborted" | "circuit-open",
    public readonly retryable: boolean,
    public readonly status?: number,
  ) { super(message); this.name = "ModelError"; }
}
