import { ModelError, type ChatMessage, type ChatOptions, type ModelOutput, type Provider } from "./types.js";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

export function buildRequest(provider: Provider, messages: ChatMessage[], options: ChatOptions): RequestInit {
  const headers = new Headers(provider.headers);
  headers.set("content-type", "application/json");
  if (provider.apiKey) headers.set("authorization", `Bearer ${provider.apiKey}`);
  let body: ObjectValue = { model: provider.model, messages, stream: false };
  if (provider.kind === "ollama") {
    body.options = {
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { num_predict: options.maxTokens }),
    };
  } else {
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body[provider.outputTokenField ?? "max_tokens"] = options.maxTokens;
  }
  return { method: "POST", headers, body: JSON.stringify(body), redirect: "error" };
}

export function normalizeOutput(provider: Provider, value: unknown): ModelOutput {
  const data = object(value);
  let text: unknown;
  let inputTokens: unknown, outputTokens: unknown, finish: unknown;
  if (provider.kind === "ollama") {
    text = object(data.message).content;
    inputTokens = data.prompt_eval_count;
    outputTokens = data.eval_count;
    finish = data.done_reason;
  } else {
    const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
    text = object(choice.message).content;
    inputTokens = object(data.usage).prompt_tokens;
    outputTokens = object(data.usage).completion_tokens;
    finish = choice.finish_reason;
  }
  if (typeof text !== "string") {
    throw new ModelError("Provider did not return a text completion", provider.name, "invalid-response", false);
  }
  return {
    text,
    model: typeof data.model === "string" ? data.model : provider.model,
    usage: { inputTokens: count(inputTokens), outputTokens: count(outputTokens) },
    finishReason: typeof finish === "string" ? finish : undefined,
  };
}
