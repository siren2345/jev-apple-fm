import { readFile } from "node:fs/promises";

const [fixturePath, countArg] = process.argv.slice(2);
if (!fixturePath) throw new Error("Usage: node benchmark_request.mjs <request.json> [count]");
const count = Number(countArg ?? 10);
if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");
const endpoint = process.env.JEV_LOCAL_URL ?? "http://127.0.0.1:8787/v1/systemone";
const payload = await readFile(fixturePath, "utf8");
const samples = [];
for (let index = 0; index < count; index += 1) {
  const started = performance.now();
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  const body = await response.json();
  if (!response.ok) throw new Error(`request ${index + 1} failed: ${JSON.stringify(body)}`);
  samples.push({ end_to_end_ms: Number((performance.now() - started).toFixed(3)), ...body.metadata.performance });
}
const values = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b);
const percentile = (key, fraction) => values(key)[Math.ceil(values(key).length * fraction) - 1];
console.log(JSON.stringify({ endpoint, fixture: fixturePath, count, request_bytes: samples[0].request_bytes, questions: samples[0].question_count, options: samples[0].option_count, latency_ms: { end_to_end: { p50: percentile("end_to_end_ms", .5), p95: percentile("end_to_end_ms", .95) }, worker: { p50: percentile("worker_ms", .5), p95: percentile("worker_ms", .95) }, queue: { p50: percentile("worker_queue_ms", .5), p95: percentile("worker_queue_ms", .95) } }, samples }, null, 2));
