import type { AIProviderRouter } from "./router.js";
import type { BatchInput, Completion } from "./types.js";
import { summarizeNumbers, type NumericSummary } from "./stats.js";

export type WorkloadOptions = {
  concurrency?: number;
  repeats?: number;
};

export type WorkloadRecord = {
  index: number;
  repeat: number;
  task: string;
  ok: boolean;
  provider?: string;
  model?: string;
  attempts?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
};

export type WorkloadSummary = {
  attempts: number;
  successful: number;
  successRate: number;
  latency?: NumericSummary;
  byProvider: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
};

export async function runWorkload(
  router: AIProviderRouter,
  jobs: BatchInput[],
  options: WorkloadOptions = {},
): Promise<WorkloadRecord[]> {
  const concurrency = options.concurrency ?? 4;
  const repeats = options.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("repeats must be a positive integer");

  const records: WorkloadRecord[] = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const results = await router.batch(jobs, concurrency);
    results.forEach((result, index) => {
      const task = jobs[index].task;
      if (result.ok) {
        const value: Completion = result.value;
        records.push({
          index,
          repeat,
          task,
          ok: true,
          provider: value.provider,
          model: value.model,
          attempts: value.attempts,
          latencyMs: value.latencyMs,
          inputTokens: value.usage.inputTokens,
          outputTokens: value.usage.outputTokens,
        });
      } else {
        records.push({
          index,
          repeat,
          task,
          ok: false,
          error: result.error.message,
        });
      }
    });
  }
  return records;
}

export function summarizeWorkload(records: WorkloadRecord[]): WorkloadSummary {
  const successful = records.filter(record => record.ok);
  const latency = successful
    .map(record => record.latencyMs)
    .filter((value): value is number => value !== undefined);
  const byProvider: Record<string, number> = {};
  successful.forEach(record => {
    if (record.provider) byProvider[record.provider] = (byProvider[record.provider] ?? 0) + 1;
  });
  return {
    attempts: records.length,
    successful: successful.length,
    successRate: records.length ? successful.length / records.length : 0,
    latency: latency.length ? summarizeNumbers(latency) : undefined,
    byProvider,
    inputTokens: successful.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: successful.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
  };
}
