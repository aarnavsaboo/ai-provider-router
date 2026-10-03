import test from "node:test";
import assert from "node:assert/strict";

import { AIProviderRouter, runWorkload, summarizeNumbers, summarizeWorkload } from "../dist/index.js";

test("numeric summary", () => {
  const result = summarizeNumbers([1, 2, 3, 4]);
  assert.equal(result.count, 4);
  assert.equal(result.median, 2.5);
});

test("workload summary", async () => {
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const router = new AIProviderRouter({ fetch })
    .addProvider({
      name: "local",
      endpoint: "http://127.0.0.1:1234/v1/chat/completions",
      model: "small-local",
      kind: "openai-compatible",
    });

  const jobs = [
    { task: "summary", messages: [{ role: "user", content: "one" }] },
    { task: "summary", messages: [{ role: "user", content: "two" }] },
  ];
  const rows = await runWorkload(router, jobs, { concurrency: 2, repeats: 2 });
  const summary = summarizeWorkload(rows);
  assert.equal(rows.length, 4);
  assert.equal(summary.successful, 4);
  assert.equal(summary.outputTokens, 8);
});
