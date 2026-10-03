import { AIProviderRouter, runWorkload, summarizeWorkload } from "../dist/index.js";

const fakeFetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  const text = body.messages.at(-1).content;
  return new Response(JSON.stringify({
    model: body.model,
    choices: [{ message: { content: "local:" + text.slice(0, 24) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 6 },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const router = new AIProviderRouter({ fetch: fakeFetch })
  .addProvider({
    name: "local",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: "example-local-model",
    kind: "openai-compatible",
  });

const jobs = Array.from({ length: 8 }, (_, i) => ({
  task: "summary",
  messages: [{ role: "user", content: `Summarize local workload item ${i}` }],
  options: { maxTokens: 64 },
}));

const rows = await runWorkload(router, jobs, { concurrency: 3, repeats: 2 });
console.log(JSON.stringify(summarizeWorkload(rows), null, 2));
