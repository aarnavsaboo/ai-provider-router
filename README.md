# AI Provider Router

A small open-source TypeScript utility by **Aarnav Saboo** for keeping LLM provider details out of application code.

The idea is simple: product code asks for a task, the router chooses a provider, and the rest of the application stays model-agnostic.

## Example

```ts
import { AIProviderRouter } from "./src/index.js";

const ai = new AIProviderRouter()
  .addProvider({
    name: "primary",
    endpoint: process.env.AI_ENDPOINT!,
    apiKey: process.env.AI_API_KEY!,
    model: process.env.AI_MODEL!
  })
  .addRule({
    when: (task) => task === "summarize",
    provider: "primary"
  });

const result = await ai.chat("summarize", [
  { role: "user", content: "Summarize this document." }
]);
```

## Why

AI applications often start with one provider and slowly spread provider-specific calls across routes, jobs, and services. This keeps that integration boundary in one place.

## Design goals

- small API surface
- provider-agnostic application code
- no framework dependency
- easy to extend with routing and fallbacks

Built by **Aarnav Saboo**.

https://aarnavsaboo.github.io
