# Inference routing design

```text
Task + text messages
    -> first matching route (or first registered provider)
    -> process-local circuit check
    -> provider adapter
    -> bounded attempts + cancellation + per-attempt deadline
    -> normalized completion + usage + attempt metadata
```

## Protocol adapters

Adapters own wire formats. The OpenAI-compatible adapter reads the first text choice. The Ollama adapter reads `message.content`. Missing token counts stay unknown rather than being estimated. Non-text responses are rejected; tool-only outputs require a different interface.

The endpoint is caller-supplied and must be HTTP(S). Use HTTPS for hosted services. The library makes no discovery calls. API keys are optional because local inference may not require one. There are no embedded credentials and no automatic environment-file loading.

## Retry versus fallback

Retries stay with the current provider. Fallback moves the prompt to another named provider, so it must be configured explicitly. Permanent HTTP failures, malformed outputs and cancellation terminate the route. A failed observer cannot turn a completed inference into a retry.

The default is no retries and no implicit backup. A configured retry budget applies separately to each provider. A route may therefore take longer than a single timeout and can result in multiple billable calls. A timeout aborts the local request; it cannot guarantee remote generation has stopped.

## Circuit semantics

One exhausted transiently failing request increments the provider's failure count. Success resets it. At the threshold, calls are skipped until the cooldown expires. A skipped provider can fall through to an explicitly configured alternative. State is in memory and not shared across router instances. Concurrent recovery requests are allowed; this implementation does not serialize a single half-open probe.

## Testing boundaries

The unit suite checks both wire formats, retry/fallback policy, cancellation, timeouts, circuits and bounded batch execution with injected transports. These tests do not establish model quality, speed, cost or compatibility with every vendor. The optional local-model example requires the caller's own runtime and model.

References: [Ollama chat API](https://github.com/ollama/ollama/blob/main/docs/api.md), [OpenAI response length controls](https://help.openai.com/en/articles/5072518-controlling-the-length-of-openai-model-responses).
