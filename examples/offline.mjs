import { AIProviderRouter } from "../dist/index.js";

let calls = 0;
const mockFetch = async () => {
  calls++;
  if (calls === 1) return new Response("temporarily unavailable", { status: 503 });
  return Response.json({ choices: [{ message: { content: "A model integration with explicit fallback." }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 9 } });
};
const router = new AIProviderRouter({ fetch: mockFetch, onEvent: event => console.log(event) })
  .addProvider({ name: "primary", endpoint: "https://primary.example.invalid/chat", model: "demo" })
  .addProvider({ name: "backup", endpoint: "https://backup.example.invalid/chat", model: "demo" })
  .addRule({ when: task => task === "summarize", provider: "primary", fallbacks: ["backup"] });

console.log(await router.chat("summarize", [{ role: "user", content: "Summarize this integration." }]));
console.log(router.statistics());
