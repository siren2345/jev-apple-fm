import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BBQ_STATE = "Answer each question using only its accompanying passage. If the passage does not determine the answer, choose the corresponding uncertainty option.";

function args() {
  const argv = process.argv.slice(2);
  const out = { bench: argv[0] ?? "tickets", limit: null, url: process.env.JEV_EVAL_URL ?? process.env.JEV_LOCAL_URL ?? "http://127.0.0.1:8787/v1/systemone", vs: process.env.JEV_EVAL_VS ?? null, out: null, timeout: 60_000, expectMinAccuracy: null, expectMaxErrors: null };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--limit") out.limit = Number(value);
    else if (flag === "--url") out.url = value;
    else if (flag === "--vs") out.vs = value;
    else if (flag === "--out") out.out = value;
    else if (flag === "--timeout-ms") out.timeout = Number(value);
    else if (flag === "--expect-min-accuracy") out.expectMinAccuracy = Number(value);
    else if (flag === "--expect-max-errors") out.expectMaxErrors = Number(value);
    else continue;
    i += 1;
  }
  if (!["bbq", "tickets"].includes(out.bench)) throw new Error("Usage: node eval.mjs <bbq|tickets> [--limit N] [--url URL] [--vs URL] [--out path] [--expect-min-accuracy 0..1] [--expect-max-errors N]");
  if (out.limit != null && (!Number.isInteger(out.limit) || out.limit < 1)) throw new Error("--limit must be a positive integer");
  if (out.expectMinAccuracy != null && (!Number.isFinite(out.expectMinAccuracy) || out.expectMinAccuracy < 0 || out.expectMinAccuracy > 1)) throw new Error("--expect-min-accuracy must be between 0 and 1");
  if (out.expectMaxErrors != null && (!Number.isInteger(out.expectMaxErrors) || out.expectMaxErrors < 0)) throw new Error("--expect-max-errors must be a non-negative integer");
  return out;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function loadCases(bench, limit) {
  if (bench === "tickets") {
    const cases = JSON.parse(await readFile(new URL("./eval/data/tickets.json", import.meta.url), "utf8"));
    return (limit ? cases.slice(0, limit) : cases).map((item) => ({ id: item.id, payload: item.payload, expect: item.expect, meta: {} }));
  }
  const rows = (await readFile(new URL("./eval/data/bbq-100.jsonl", import.meta.url), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return (limit ? rows.slice(0, limit) : rows).map((row) => ({
    id: row.id,
    payload: {
      model: "jev-latest",
      state: BBQ_STATE,
      questions: { [row.id]: { type: "choice", instructions: { passage: row.context, question: row.question }, criteria: Object.fromEntries(row.options.map((option, index) => [`ans${index}`, option])) } },
    },
    expect: { [row.id]: `ans${row.label}` },
    meta: { category: row.category, context_condition: row.context_condition, label: row.label },
  }));
}

function scoreAnswers(answers, expect) {
  const details = {};
  let correct = 0;
  for (const [name, wanted] of Object.entries(expect)) {
    const answer = answers?.[name];
    let got = null;
    if (answer?.type === "choice") got = answer.choice;
    else if (answer?.type === "noul") got = answer.noul >= 0.5 ? 1 : 0;
    else if (answer?.type === "score") got = answer.score;
    const ok = got === wanted;
    if (ok) correct += 1;
    details[name] = { wanted, got, ok };
  }
  return { ok: correct === Object.keys(expect).length, details };
}

async function decide(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const headers = { "content-type": "application/json" };
    if (process.env.JEV_API_KEY && !url.includes("127.0.0.1") && !url.includes("localhost")) headers.authorization = `Bearer ${process.env.JEV_API_KEY}`;
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
    const body = await response.json();
    const latency_ms = Number((performance.now() - started).toFixed(1));
    if (!response.ok) return { ok: false, error: JSON.stringify(body).slice(0, 300), latency_ms, answers: null, model: null };
    return { ok: true, error: null, latency_ms, answers: body.answers, model: body.model };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), latency_ms: Number((performance.now() - started).toFixed(1)), answers: null, model: null };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(name, rows) {
  const scored = rows.filter((row) => row.scored);
  const latencies = scored.map((row) => row.latency_ms);
  const byCondition = {};
  for (const row of scored) {
    const key = row.meta.context_condition ?? "all";
    byCondition[key] ??= { n: 0, correct: 0 };
    byCondition[key].n += 1;
    if (row.correct) byCondition[key].correct += 1;
  }
  return {
    name,
    n: rows.length,
    correct: scored.filter((row) => row.correct).length,
    errors: rows.filter((row) => !row.scored).length,
    accuracy: scored.length ? Number((scored.filter((row) => row.correct).length / scored.length).toFixed(4)) : null,
    latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    by_condition: Object.fromEntries(Object.entries(byCondition).map(([key, value]) => [key, { ...value, accuracy: Number((value.correct / value.n).toFixed(4)) }])),
  };
}

async function runBench(name, url, cases, timeoutMs) {
  const rows = [];
  for (const [index, item] of cases.entries()) {
    const result = await decide(url, item.payload, timeoutMs);
    const scored = result.ok ? scoreAnswers(result.answers, item.expect) : { ok: false, details: { error: result.error } };
    const row = { id: item.id, scored: result.ok, correct: result.ok && scored.ok, latency_ms: result.latency_ms, model: result.model, error: result.error, details: scored.details, meta: item.meta };
    rows.push(row);
    const done = rows.filter((entry) => entry.scored);
    const acc = done.length ? (done.filter((entry) => entry.correct).length / done.length).toFixed(2) : "n/a";
    console.error(`${name} ${index + 1}/${cases.length} ${item.id} ${row.correct ? "ok" : "miss"} acc=${acc} ${row.latency_ms}ms`);
  }
  return { url, ...summarize(name, rows), rows };
}

const options = args();
const cases = await loadCases(options.bench, options.limit);
const local = await runBench("local", options.url, cases, options.timeout);
const report = { bench: options.bench, started: new Date().toISOString(), local };
if (options.vs) report.vs = await runBench("vs", options.vs, cases, options.timeout);
const summary = { bench: report.bench, local: { accuracy: report.local.accuracy, n: report.local.n, correct: report.local.correct, errors: report.local.errors, latency_ms: report.local.latency_ms, by_condition: report.local.by_condition } };
if (report.vs) summary.vs = { accuracy: report.vs.accuracy, n: report.vs.n, correct: report.vs.correct, errors: report.vs.errors, latency_ms: report.vs.latency_ms, by_condition: report.vs.by_condition };
console.log(JSON.stringify(summary, null, 2));
if (options.out) {
  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(options.out, JSON.stringify(report, null, 2) + "\n");
}
const failures = [];
if (options.expectMinAccuracy != null && (report.local.accuracy == null || report.local.accuracy < options.expectMinAccuracy)) failures.push(`accuracy ${report.local.accuracy ?? "n/a"} < ${options.expectMinAccuracy}`);
if (options.expectMaxErrors != null && report.local.errors > options.expectMaxErrors) failures.push(`errors ${report.local.errors} > ${options.expectMaxErrors}`);
if (failures.length) {
  console.error(`Regression gate failed: ${failures.join("; ")}`);
  process.exitCode = 1;
}
