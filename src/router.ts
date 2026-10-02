import { buildRequest, normalizeOutput } from "./adapters.js";
import { ModelError, type AttemptEvent, type BatchInput, type BatchResult, type ChatMessage,
  type ChatOptions, type Completion, type ModelOutput, type Provider, type RouteRule, type RouterOptions } from "./types.js";

const transient = new Set([408, 429, 500, 502, 503, 504]);
type State = { failures: number; openUntil: number };

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function abortError(provider = "router"): ModelError {
  return new ModelError("Request cancelled", provider, "aborted", false);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AIProviderRouter {
  private providers = new Map<string, Provider>();
  private rules: RouteRule[] = [];
  private states = new Map<string, State>();
  private counters = new Map<string, { attempts: number; successes: number; failures: number; skipped: number }>();
  private fetcher: typeof globalThis.fetch;
  private now: () => number;
  private retryDelay: number;
  private threshold: number;
  private cooldown: number;

  constructor(private readonly options: RouterOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.retryDelay = options.retryDelayMs ?? 200;
    this.threshold = options.failureThreshold ?? 3;
    this.cooldown = options.cooldownMs ?? 30_000;
    if (!Number.isFinite(this.retryDelay) || this.retryDelay < 0) throw new Error("retryDelayMs must be nonnegative");
    positive(this.threshold, "failureThreshold");
    if (!Number.isInteger(this.threshold)) throw new Error("failureThreshold must be an integer");
    positive(this.cooldown, "cooldownMs");
  }

  addProvider(provider: Provider): this {
    if (!provider.name?.trim() || !provider.model?.trim()) throw new Error("Provider name and model are required");
    if (this.providers.has(provider.name)) throw new Error(`Duplicate provider: ${provider.name}`);
    const url = new URL(provider.endpoint);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Endpoint must use HTTP or HTTPS");
    if (provider.kind && !["openai-compatible", "ollama"].includes(provider.kind)) throw new Error("Unknown provider kind");
    if (provider.outputTokenField && !["max_tokens", "max_completion_tokens"].includes(provider.outputTokenField)) throw new Error("Unknown output token field");
    const retries = provider.retries ?? 0;
    if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error("retries must be between 0 and 5");
    positive(provider.timeoutMs ?? 30_000, "timeoutMs");
    const copy = Object.freeze({ ...provider, headers: Object.freeze({ ...provider.headers }) });
    this.providers.set(provider.name, copy);
    this.states.set(provider.name, { failures: 0, openUntil: 0 });
    this.counters.set(provider.name, { attempts: 0, successes: 0, failures: 0, skipped: 0 });
    return this;
  }

  addRule(rule: RouteRule): this {
    if (typeof rule.when !== "function") throw new Error("Rule needs a task predicate");
    this.rules.push({ ...rule, fallbacks: [...(rule.fallbacks ?? [])] });
    return this;
  }

  private route(task: string): Provider[] {
    const rule = this.rules.find(rule => rule.when(task));
    const first = this.providers.keys().next().value as string | undefined;
    const names = rule ? [rule.provider, ...(rule.fallbacks ?? [])] : first ? [first] : [];
    if (!names.length) throw new Error("No AI provider configured");
    return [...new Set(names)].map(name => {
      const provider = this.providers.get(name);
      if (!provider) throw new Error(`Route refers to unknown provider: ${name}`);
      return provider;
    });
  }

  pick(task: string): Provider { return this.route(task)[0]; }

  health() {
    return [...this.states].map(([provider, state]) => ({ provider,
      consecutiveFailures: state.failures, openUntil: state.openUntil, open: state.openUntil > this.now() }));
  }

  statistics() { return [...this.counters].map(([provider, counts]) => ({ provider, ...counts })); }

  private emit(event: AttemptEvent): void {
    const counts = this.counters.get(event.provider)!;
    if (event.phase === "skipped") counts.skipped++;
    else { counts.attempts++; if (event.phase === "success") counts.successes++; else counts.failures++; }
    try { this.options.onEvent?.(event); } catch { /* Observers must not change generation results. */ }
  }

  private async attempt(provider: Provider, messages: ChatMessage[], options: ChatOptions): Promise<ModelOutput> {
    if (options.signal?.aborted) throw abortError(provider.name);
    const controller = new AbortController();
    let rejectBoundary!: (reason: Error) => void;
    let boundaryError: ModelError | undefined;
    const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
    const stop = (error: ModelError) => { boundaryError = error; controller.abort(); rejectBoundary(error); };
    const onAbort = () => stop(abortError(provider.name));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop(new ModelError("Provider request timed out", provider.name, "timeout", true)), provider.timeoutMs ?? 30_000);
    const perform = async () => {
      const response = await this.fetcher(provider.endpoint, { ...buildRequest(provider, messages, options), signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelError(`Provider returned HTTP ${response.status}`, provider.name, "http", transient.has(response.status), response.status);
      }
      const data: unknown = await response.json();
      return normalizeOutput(provider, data);
    };
    try { return await Promise.race([perform(), boundary]); }
    catch (error) {
      if (boundaryError) throw boundaryError;
      if (error instanceof ModelError) throw error;
      if (error instanceof TypeError) throw new ModelError("Provider transport failed", provider.name, "network", true);
      throw new ModelError("Provider returned an invalid response", provider.name, "invalid-response", false);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async chat(task: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<Completion> {
    if (typeof task !== "string" || !task.trim()) throw new Error("Task must be a nonempty string");
    if (!Array.isArray(messages) || !messages.length || messages.some(m => !m ||
      !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string")) throw new Error("Provide text chat messages");
    if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1)) throw new Error("maxTokens must be a positive integer");
    if (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) throw new Error("temperature must be between 0 and 2");
    if (options.signal?.aborted) throw abortError();
    const start = this.now();
    let attempts = 0;
    let last: ModelError | undefined;
    for (const provider of this.route(task)) {
      const state = this.states.get(provider.name)!;
      if (state.openUntil > this.now()) {
        last = new ModelError("Provider circuit is open", provider.name, "circuit-open", true);
        this.emit({ provider: provider.name, phase: "skipped", attempt: attempts, latencyMs: 0, code: last.code });
        continue;
      }
      for (let retry = 0; retry <= (provider.retries ?? 0); retry++) {
        if (options.signal?.aborted) throw abortError(provider.name);
        const attemptStart = this.now(); attempts++;
        try {
          const output = await this.attempt(provider, messages, options);
          state.failures = 0; state.openUntil = 0;
          this.emit({ provider: provider.name, phase: "success", attempt: attempts, latencyMs: this.now() - attemptStart });
          return { ...output, provider: provider.name, attempts, latencyMs: this.now() - start };
        } catch (error) {
          last = error as ModelError;
          this.emit({ provider: provider.name, phase: "failure", attempt: attempts, latencyMs: this.now() - attemptStart, code: last.code });
          if (!last.retryable) throw last;
          if (retry < (provider.retries ?? 0)) await delay(Math.min(this.retryDelay * 2 ** retry, 5_000), options.signal);
        }
      }
      state.failures++;
      if (state.failures >= this.threshold) state.openUntil = this.now() + this.cooldown;
    }
    throw last ?? new Error("No route completed");
  }

  async batch(inputs: BatchInput[], concurrency = 4): Promise<BatchResult[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
    const results = new Array<BatchResult>(inputs.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < inputs.length) {
        const index = cursor++;
        const input = inputs[index];
        try { results[index] = { ok: true, value: await this.chat(input.task, input.messages, input.options) }; }
        catch (error) { results[index] = { ok: false, error: error instanceof Error ? error : new Error(String(error)) }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, worker));
    return results;
  }
}
