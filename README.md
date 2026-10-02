# AI Provider Router

**An inspectable inference-routing layer for language-model integrations.**

Keep provider protocols, task routing and failure handling out of the rest of an AI pipeline. The router normalizes text completions from OpenAI-compatible endpoints and Ollama, with explicit fallback routes, bounded retries, per-attempt timeouts, cancellation and process-local circuit breaking.

Maintained by **Aarnav Saboo**. TypeScript, Node.js 20+, MIT. No runtime package dependencies.

## Run without an API key

```bash
npm install
npm test
npm run demo
```

The demo injects a mock transport, simulates a primary-provider failure and uses a configured backup. Nothing is sent to a real model. Tests also use mocked responses; they are not live-provider compatibility certification.

## Route a task

```typescript
import { AIProviderRouter } from "./dist/index.js";

const router = new AIProviderRouter()
  .addProvider({
    name: "local",
    kind: "ollama",
    endpoint: "http://localhost:11434/api/chat",
    model: "your-installed-model",
    timeoutMs: 60_000,
  })
  .addRule({ when: task => task === "summarize", provider: "local" });

const result = await router.chat("summarize", [
  { role: "user", content: "Summarize these retrieved passages: ..." },
], { maxTokens: 250 });

console.log(result.text, result.usage, result.latencyMs);
```

A local Ollama server and an installed model are required for that example. The separate `examples/local-model.mjs` script reads `AI_MODEL` and optional `AI_ENDPOINT`/`AI_API_KEY` environment variables.

## Explicit provider boundaries

`kind: "openai-compatible"` sends a non-streaming chat-completions request to the exact endpoint supplied. It defaults to `max_tokens`; set `outputTokenField: "max_completion_tokens"` for endpoints requiring that field. Model-specific capabilities still vary. An OpenAI-compatible protocol is not a promise that every hosted provider accepts the same options.

`kind: "ollama"` maps the generation limit to `options.num_predict` and normalizes Ollama's usage fields. Neither adapter supports tool calls or multimodal messages in this version.

## Failure handling

```typescript
router.addProvider({
  name: "backup", endpoint: "https://your-provider.example/v1/chat/completions",
  model: "your-model", apiKey: process.env.AI_API_KEY, retries: 1,
});
router.addRule({
  when: task => task === "extract",
  provider: "local",
  fallbacks: ["backup"],
});
```

Fallbacks are opt-in. Without a matching rule, only the first registered provider is used. Invalid request/response shapes and non-transient HTTP errors stop immediately. Transport failures, timeouts and HTTP 408/429/500/502/503/504 can retry and then follow an explicit fallback route.

Provider `retries` means additional attempts, defaults to zero and is capped at five. Backoff is exponential and capped at five seconds. It does not currently honor `Retry-After`. A timeout is per attempt, not a whole-route deadline. Retrying an inference call can duplicate provider work and cost.

## Cancellation, batches and observability

```typescript
const controller = new AbortController();
const result = await router.chat("extract", messages, { signal: controller.signal });
const batch = await router.batch(jobs, 3); // at most three jobs running at once
console.log(router.health(), router.statistics());
```

`batch` keeps input order and returns a success/error record per job. Each job owns its retry/fallback sequence. This limits concurrent jobs; it is not a distributed rate limiter.

An `onEvent` callback receives provider, phase, attempt, duration and error code—never prompt or completion text. Counters and circuit state are process-local and reset when the router is recreated. Observer exceptions do not change model results.

## Design and scope

The circuit opens after a configurable number of exhausted, transiently failing requests and allows calls again after a cooldown. It is a lightweight local policy, not a coordinated half-open probe across workers. See [design notes](docs/design.md) for the exact semantics.

There is no model training, automatic prompt rewriting, embedding generation, response cache or streaming in this release. That keeps the boundary focused: a task and text messages in; a normalized completion and execution metadata out.

### Migration from 0.1

`addProvider`, `addRule`, `pick` and `chat` remain available. `chat` now returns a normalized `Completion` instead of the raw provider JSON. Use `result.text` and `result.usage`. Rules are evaluated in registration order; the first match wins.
