import { AIProviderRouter } from "../dist/index.js";

if (!process.env.AI_MODEL) throw new Error("Set AI_MODEL to a model installed in your Ollama instance");
const router = new AIProviderRouter().addProvider({
  name: "local",
  kind: "ollama",
  endpoint: process.env.AI_ENDPOINT ?? "http://localhost:11434/api/chat",
  model: process.env.AI_MODEL,
  apiKey: process.env.AI_API_KEY,
  timeoutMs: 60_000,
});
const response = await router.chat("explain", [
  { role: "user", content: "Explain reciprocal-rank fusion in three sentences." },
], { maxTokens: 200 });
console.log(response.text);
console.log(response.usage);
