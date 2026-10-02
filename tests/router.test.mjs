import test from "node:test";
import assert from "node:assert/strict";
import { AIProviderRouter, ModelError, buildRequest, normalizeOutput } from "../dist/index.js";

const message = [{ role: "user", content: "demo-input" }];
const p = (name="one", extra={}) => ({ name, endpoint:`https://${name}.example.invalid/chat`, model:"fixture", ...extra });
const response = (text="ok") => Response.json({ choices:[{message:{content:text},finish_reason:"stop"}],usage:{prompt_tokens:2,completion_tokens:3} });
const router = (fetch, options={}) => new AIProviderRouter({ fetch, retryDelayMs:0, ...options });

test("normalizes a chat response and usage", async () => {
  const r=router(async()=>response()).addProvider(p());
  const out=await r.chat("classify",message);
  assert.equal(out.text,"ok"); assert.equal(out.usage.inputTokens,2); assert.equal(out.attempts,1);
});
test("normalizes Ollama responses",()=>{
  const out=normalizeOutput(p("local",{kind:"ollama"}),{message:{content:"hello"},eval_count:4,prompt_eval_count:5,done_reason:"stop"});
  assert.equal(out.text,"hello");assert.equal(out.usage.outputTokens,4);
});
test("maps Ollama options",()=>{
  const body=JSON.parse(buildRequest(p("local",{kind:"ollama"}),message,{maxTokens:12,temperature:0.2}).body);
  assert.equal(body.options.num_predict,12);assert.equal(body.stream,false);
});
test("supports a configurable completion token field",()=>{
  const body=JSON.parse(buildRequest(p("one",{outputTokenField:"max_completion_tokens"}),message,{maxTokens:12}).body);
  assert.equal(body.max_completion_tokens,12);assert.equal(body.max_tokens,undefined);
});
test("selects a task-specific model",async()=>{
  let endpoint;
  const r=router(async(url)=>{endpoint=url;return response();}).addProvider(p()).addProvider(p("two"))
    .addRule({when:t=>t==="extract",provider:"two"});
  assert.equal((await r.chat("extract",message)).provider,"two"); assert.match(endpoint,/two/);
});
test("does not use unrelated providers as implicit fallbacks",async()=>{
  let calls=0;
  const r=router(async()=>{calls++;return new Response("bad",{status:503});}).addProvider(p()).addProvider(p("two"));
  await assert.rejects(r.chat("test",message),ModelError);assert.equal(calls,1);
});
test("uses explicitly configured fallback",async()=>{
  const r=router(async(url)=>url.includes("one")?new Response("bad",{status:503}):response())
    .addProvider(p()).addProvider(p("two")).addRule({when:()=>true,provider:"one",fallbacks:["two"]});
  const out=await r.chat("test",message);assert.equal(out.provider,"two");assert.equal(out.attempts,2);
});
test("retries transient errors within the provider budget",async()=>{
  let calls=0;const r=router(async()=>++calls===1?new Response("busy",{status:429}):response()).addProvider(p("one",{retries:1}));
  assert.equal((await r.chat("test",message)).attempts,2);
});
test("terminal HTTP errors do not fall back",async()=>{
  let calls=0;const r=router(async()=>{calls++;return new Response("bad",{status:400});})
    .addProvider(p()).addProvider(p("two")).addRule({when:()=>true,provider:"one",fallbacks:["two"]});
  await assert.rejects(r.chat("test",message),e=>e.status===400);assert.equal(calls,1);
});
test("rejects malformed response JSON",async()=>{
  const r=router(async()=>new Response("{oops")).addProvider(p());
  await assert.rejects(r.chat("test",message),e=>e.code==="invalid-response");
});
test("rejects non-text completions",()=>{
  assert.throws(()=>normalizeOutput(p(),{choices:[{message:{content:null}}]}),ModelError);
});
test("enforces timeout even with a transport that never resolves",async()=>{
  const r=router(()=>new Promise(()=>{})).addProvider(p("one",{timeoutMs:5}));
  await assert.rejects(r.chat("test",message),e=>e.code==="timeout");
});
test("honors pre-cancelled requests",async()=>{
  let calls=0;const c=new AbortController();c.abort();
  const r=router(async()=>{calls++;return response();}).addProvider(p());
  await assert.rejects(r.chat("test",message,{signal:c.signal}),e=>e.code==="aborted");assert.equal(calls,0);
});
test("honors cancellation during a request",async()=>{
  const c=new AbortController();const r=router(()=>new Promise(()=>{})).addProvider(p());
  const pending=r.chat("test",message,{signal:c.signal});setTimeout(()=>c.abort(),3);
  await assert.rejects(pending,e=>e.code==="aborted");
});
test("opens and recovers a process-local circuit",async()=>{
  let now=1000,calls=0;
  const r=router(async()=>++calls===1?new Response("bad",{status:503}):response(),{now:()=>now,failureThreshold:1,cooldownMs:20}).addProvider(p());
  await assert.rejects(r.chat("test",message));
  await assert.rejects(r.chat("test",message),e=>e.code==="circuit-open");assert.equal(calls,1);
  now+=21;assert.equal((await r.chat("test",message)).text,"ok");assert.equal(r.health()[0].consecutiveFailures,0);
});
test("bounds batch concurrency and preserves ordering",async()=>{
  let active=0,peak=0;
  const r=router(async(url,init)=>{active++;peak=Math.max(peak,active);const data=JSON.parse(init.body);await new Promise(resolve=>setTimeout(resolve,3));active--;return response(data.messages[0].content);}).addProvider(p());
  const results=await r.batch(Array.from({length:7},(_,i)=>({task:"test",messages:[{role:"user",content:String(i)}]})),2);
  assert.equal(peak,2);assert.deepEqual(results.map(r=>r.value.text),["0","1","2","3","4","5","6"]);
});
test("batch isolates individual failures",async()=>{
  const r=router(async()=>response()).addProvider(p());
  const out=await r.batch([{task:"test",messages:message},{task:"test",messages:[]}]);
  assert.equal(out[0].ok,true);assert.equal(out[1].ok,false);
});
test("events contain no prompts or response text",async()=>{
  const events=[];const r=router(async()=>response("output-marker"),{onEvent:e=>events.push(e)}).addProvider(p());
  await r.chat("test",message);const raw=JSON.stringify(events);
  assert.equal(raw.includes("demo-input"),false);assert.equal(raw.includes("output-marker"),false);
});
test("observer exceptions do not change completion",async()=>{
  const r=router(async()=>response(),{onEvent:()=>{throw new Error("observer");}}).addProvider(p());
  assert.equal((await r.chat("test",message)).text,"ok");
});
test("validates provider and routing configuration",async()=>{
  const r=router(async()=>response()).addProvider(p());
  assert.throws(()=>r.addProvider(p()),/Duplicate/);
  assert.throws(()=>router(async()=>response()).addProvider(p("bad",{retries:6})),/retries/);
  r.addRule({when:()=>true,provider:"missing"});
  await assert.rejects(r.chat("test",message),/unknown provider/);
});
test("validates request options",async()=>{
  const r=router(async()=>response()).addProvider(p());
  await assert.rejects(r.chat("test",message,{maxTokens:0}));
  await assert.rejects(r.chat("test",message,{temperature:NaN}));
  await assert.rejects(r.batch([],0));
});
test("keeps absent token counts unknown",()=>{
  const out=normalizeOutput(p(),{choices:[{message:{content:"ok"}}]});
  assert.equal(out.usage.inputTokens,undefined);
});
