# AI Provider Router

A small inference-routing layer for local and OpenAI-compatible language-model runtimes.

The package keeps provider protocols, task routing, retries, timeouts, fallback order, bounded batch execution and run metrics outside application code. It is useful for experiments where the same workload is moved between a local model server and another compatible endpoint without rewriting the rest of the pipeline.

The emphasis is explicit behaviour rather than a large framework abstraction.

## Supported protocols

- OpenAI-compatible chat-completions endpoints
- Ollama chat endpoints

Adapters normalize provider output into the same completion shape.

## Example

```typescript
import { AIProviderRouter } from "ai-provider-router";

const router = new AIProviderRouter()
  .addProvider({
    name: "small-local",
    kind: "ollama",
    endpoint: "http://127.0.0.1:11434/api/chat",
    model: "qwen3:4b",
    timeoutMs: 60_000,
  })
  .addProvider({
    name: "larger-local",
    kind: "openai-compatible",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: "local-model",
    timeoutMs: 60_000,
  })
  .addRule({
    when: task => task === "summary",
    provider: "small-local",
    fallbacks: ["larger-local"],
  });

const result = await router.chat(
  "summary",
  [{ role: "user", content: "Summarize the retrieved passages." }],
  { maxTokens: 160 },
);
```

## Routing and execution

Routes are explicit and evaluated in registration order.

Each provider can configure:

- model
- endpoint
- protocol adapter
- timeout
- retry count
- extra headers
- output token field

A route can define a primary provider and ordered fallbacks.

Transient transport errors and selected HTTP responses can retry before the next configured provider is attempted. Each attempt emits timing metadata through the event callback.

## Local workload runner

The repository also contains utilities for repeatable workload experiments.

```typescript
import { runWorkload, summarizeWorkload } from "ai-provider-router";

const records = await runWorkload(router, jobs, {
  concurrency: 4,
  repeats: 3,
});

console.log(summarizeWorkload(records));
```

A workload record keeps:

- task name
- provider/model selected
- total router latency
- attempt count
- input/output token counts when available
- success/failure
- repetition index

This makes it possible to compare route choices and concurrency without coupling the benchmark harness to a provider SDK.

## Bounded batches

```typescript
const batch = await router.batch(jobs, 4);
```

Input order is preserved in the returned results. Each job owns its own retry/fallback sequence.

The concurrency bound limits active jobs in the current process. It is not a distributed scheduler or global rate limiter.

## Runtime observations

`statistics()` exposes per-provider attempt/success/failure/skip counters.

`health()` exposes current consecutive-failure and cooldown state.

The workload helpers add percentile summaries on top without changing the router itself.

## Repository layout

- `src/adapters.ts` — request/response protocol adapters
- `src/router.ts` — route selection, retries, timeouts and batches
- `src/types.ts` — public data types
- `src/workload.ts` — repeatable batch workload runner
- `src/stats.ts` — latency/token summary helpers
- `examples/` — offline/local examples
- `docs/` — routing and local runtime notes
- `tests/` — deterministic tests with mocked transports

No provider account is required for the included tests.

Maintained by **Aarnav Saboo**.
