import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const fmBaseUrl = (process.env.FM_BASE_URL ?? "http://127.0.0.1:1976/v1").replace(/\/$/, "");
const maxBodyBytes = 1_000_000;
const nativeChoiceBinary = new URL("./fm_choice", import.meta.url).pathname;
const nativeDecisionBinary = new URL("./fm_decide", import.meta.url).pathname;
const nativeWorkerBinary = new URL("./fm_worker", import.meta.url).pathname;
const envInt = (name, fallback) => { const value = Number(process.env[name]); return Number.isInteger(value) ? value : fallback; };
export const defaultStateBudget = {
  max_array_items: envInt("JEV_STATE_MAX_ARRAY", 16),
  max_string_chars: envInt("JEV_STATE_MAX_STRING", 160),
  max_object_keys: envInt("JEV_STATE_MAX_KEYS", 32),
  max_depth: envInt("JEV_STATE_MAX_DEPTH", 6),
  max_bytes: envInt("JEV_STATE_MAX_BYTES", 2048),
};
const stateBudgetEnabled = process.env.JEV_STATE_BUDGET !== "off" && defaultStateBudget.max_bytes > 0;

function send(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function apiError(res, status, message, type = "invalid_request_error") { send(res, status, { error: { message, type } }); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isStructured(value) { return typeof value === "string" || isRecord(value) || Array.isArray(value); }

async function readJson(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > maxBodyBytes) throw new Error("Request body exceeds 1 MB"); chunks.push(chunk); }
  try { return { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")), bodyBytes: size }; } catch { throw new Error("Request body must be valid JSON"); }
}

function optionKeys(question) { return question.type === "choice" ? Object.keys(question.criteria) : []; }
function validateQuestion(name, question) {
  if (!isRecord(question) || !["choice", "noul", "score"].includes(question.type)) throw new Error(`questions.${name}.type must be choice, noul, or score`);
  if (!isStructured(question.instructions)) throw new Error(`questions.${name}.instructions is required and must be string, object, or array`);
  if (question.type === "choice") {
    if (!isRecord(question.criteria) || optionKeys(question).length < 1 || optionKeys(question).length > 255) throw new Error(`questions.${name}.criteria must be an option map with 1 to 255 options`);
  }
  if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10 || !question.criteria.every(isStructured))) throw new Error(`questions.${name}.criteria must be an ordered array of 2 to 10 levels`);
  if (question.type === "noul" && question.criteria !== undefined && (!isRecord(question.criteria) || !["true", "false"].every((key) => question.criteria[key] === undefined || isStructured(question.criteria[key])))) throw new Error(`questions.${name}.criteria must be an object with optional true and false descriptions`);
}

export function validateRequest(payload) {
  if (!isRecord(payload)) throw new Error("Request body must be an object");
  if (typeof payload.model !== "string" || payload.model.length === 0) throw new Error("model is required and must be a string");
  if (!isStructured(payload.state)) throw new Error("state is required and must be a string, object, or array");
  if (!isRecord(payload.questions) || Object.keys(payload.questions).length === 0) throw new Error("questions must be a non-empty object");
  for (const [name, question] of Object.entries(payload.questions)) validateQuestion(name, question);
}

function utf8Bytes(value) { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
function compactState(value, depth, limits, stats) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length <= limits.max_string_chars) return value;
    stats.truncated = true;
    stats.omitted_string_chars += value.length - limits.max_string_chars;
    return value.slice(0, limits.max_string_chars);
  }
  if (depth >= limits.max_depth) {
    stats.truncated = true;
    return { _omitted: "max_depth" };
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.max_array_items).map((item) => compactState(item, depth + 1, limits, stats));
    if (value.length > limits.max_array_items) {
      stats.truncated = true;
      stats.omitted_array_items += value.length - limits.max_array_items;
      kept.push({ _omitted: value.length - limits.max_array_items });
    }
    return kept;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const out = {};
    for (const key of keys.slice(0, limits.max_object_keys)) out[key] = compactState(value[key], depth + 1, limits, stats);
    if (keys.length > limits.max_object_keys) {
      stats.truncated = true;
      stats.omitted_keys += keys.length - limits.max_object_keys;
      out._omitted_keys = keys.length - limits.max_object_keys;
    }
    return out;
  }
  return value;
}
export function budgetState(state, limits = defaultStateBudget) {
  const originalBytes = utf8Bytes(state);
  if (!stateBudgetEnabled && limits === defaultStateBudget) return { state, stats: { truncated: false, original_bytes: originalBytes, budgeted_bytes: originalBytes, omitted_array_items: 0, omitted_keys: 0, omitted_string_chars: 0, limits } };
  let applied = { ...limits };
  const run = () => {
    const stats = { truncated: false, omitted_array_items: 0, omitted_keys: 0, omitted_string_chars: 0 };
    const budgeted = compactState(state, 0, applied, stats);
    return { state: budgeted, stats, bytes: utf8Bytes(budgeted) };
  };
  let result = run();
  while (result.bytes > applied.max_bytes && (applied.max_array_items > 1 || applied.max_string_chars > 32 || applied.max_object_keys > 8)) {
    applied = {
      ...applied,
      max_array_items: Math.max(1, Math.floor(applied.max_array_items / 2)),
      max_string_chars: Math.max(32, Math.floor(applied.max_string_chars / 2)),
      max_object_keys: Math.max(8, Math.floor(applied.max_object_keys / 2)),
    };
    result = run();
  }
  return { state: result.state, stats: { truncated: result.stats.truncated || result.bytes !== originalBytes, original_bytes: originalBytes, budgeted_bytes: result.bytes, omitted_array_items: result.stats.omitted_array_items, omitted_keys: result.stats.omitted_keys, omitted_string_chars: result.stats.omitted_string_chars, limits: applied } };
}

function probabilityObjectSchema(keys) { return { type: "object", additionalProperties: false, properties: Object.fromEntries(keys.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])), required: keys }; }
function rawAnswerSchema(question) {
  if (question.type === "noul") return { type: "object", additionalProperties: false, properties: { noul: { type: "number", minimum: 0, maximum: 1 } }, required: ["noul"] };
  const keys = question.type === "choice" ? optionKeys(question) : question.criteria.map((_, index) => String(index));
  return { type: "object", additionalProperties: false, properties: { probabilities: probabilityObjectSchema(keys) }, required: ["probabilities"] };
}
export function responseSchema(questions) {
  const properties = Object.fromEntries(Object.entries(questions).map(([name, question]) => [name, rawAnswerSchema(question)]));
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

function normalizeDistribution(probabilities, keys) {
  if (!isRecord(probabilities) || Object.keys(probabilities).length !== keys.length || !keys.every((key) => typeof probabilities[key] === "number" && Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 1)) return null;
  const total = keys.reduce((sum, key) => sum + probabilities[key], 0);
  return total > 0 ? Object.fromEntries(keys.map((key) => [key, probabilities[key] / total])) : null;
}
function entropyConfidence(probabilities) {
  const values = Object.values(probabilities);
  if (values.length === 1) return 1;
  const entropy = -values.reduce((sum, value) => value === 0 ? sum : sum + value * Math.log(value), 0);
  return Number((1 - entropy / Math.log(values.length)).toFixed(6));
}
function decorateAnswer(question, raw) {
  if (!isRecord(raw)) return null;
  if (question.type === "noul") return typeof raw.noul === "number" && raw.noul >= 0 && raw.noul <= 1 ? { type: "noul", noul: raw.noul } : null;
  const keys = question.type === "choice" ? optionKeys(question) : question.criteria.map((_, index) => String(index));
  const probabilities = normalizeDistribution(raw.probabilities, keys);
  if (!probabilities) return null;
  const confidence = entropyConfidence(probabilities);
  if (question.type === "choice") {
    const choice = keys.reduce((best, key) => probabilities[key] > probabilities[best] ? key : best, keys[0]);
    return { type: "choice", choice, probabilities, confidence };
  }
  const score = keys.reduce((sum, key) => sum + Number(key) * probabilities[key], 0);
  const legend = Object.fromEntries(question.criteria.map((level, index) => [String(index), typeof level === "string" ? level : JSON.stringify(level)]));
  return { type: "score", score, legend, probabilities, confidence };
}
export function decorateAnswers(rawAnswers, questions) {
  if (!isRecord(rawAnswers) || Object.keys(rawAnswers).length !== Object.keys(questions).length) return null;
  const answers = {};
  for (const [name, question] of Object.entries(questions)) { const answer = decorateAnswer(question, rawAnswers[name]); if (!answer) return null; answers[name] = answer; }
  return answers;
}

function nativeChoice(state, instructions, criteria) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativeChoiceBinary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("native Choice timed out")); }, 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(new Error("native Choice unavailable: " + error.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("native Choice failed: " + (stderr || stdout)));
      try {
        const choice = JSON.parse(stdout).choice;
        if (!Object.hasOwn(criteria, choice)) throw new Error("returned an invalid option");
        resolve(choice);
      } catch (error) { reject(new Error("native Choice returned invalid JSON: " + (error instanceof Error ? error.message : "unknown error"))); }
    });
    child.stdin.end(JSON.stringify({ state, instructions, criteria }));
  });
}

class NativeDecisionWorker {
  constructor() { this.child = null; this.pending = new Map(); this.nextId = 0; }
  start() {
    if (this.child?.exitCode === null) return;
    this.child = spawn(nativeWorkerBinary, [], { stdio: ["pipe", "pipe", "pipe"] });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      try { const message = JSON.parse(line); const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.resolve({ choices: message.choices, workerMs: Number(message.worker_ms), roundTripMs: Number((performance.now() - pending.started).toFixed(3)) }); } catch { /* Ignore malformed worker output. */ }
    });
    this.child.on("exit", () => { for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error("native decision worker exited")); } this.pending.clear(); });
  }
  decide(payload) {
    this.start();
    return new Promise((resolve, reject) => {
      const id = String(++this.nextId); const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("native decision timed out")); }, 30_000);
      this.pending.set(id, { resolve, reject, timer, started: performance.now() });
      this.child.stdin.write(JSON.stringify({ id, state: payload.state, questions: decisionQuestions(payload.questions) }) + "\n");
    });
  }
}
function decisionQuestions(questions) {
  return Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const criteria = question.type === "choice"
      ? question.criteria
      : question.type === "noul"
        ? { true: question.criteria?.true ?? "The answer is yes", false: question.criteria?.false ?? "The answer is no" }
        : Object.fromEntries(question.criteria.map((level, index) => [String(index), level]));
    return [name, { instructions: question.instructions, criteria }];
  }));
}
const nativeWorker = new NativeDecisionWorker();

function questionMetrics(questions) {
  return { question_count: Object.keys(questions).length, option_count: Object.values(questions).reduce((total, question) => total + (question.type === "choice" ? Object.keys(question.criteria).length : question.type === "score" ? question.criteria.length : 2), 0) };
}
async function decide(payload, bodyBytes) {
  const budget = budgetState(payload.state);
  const { choices, workerMs, roundTripMs } = await nativeWorker.decide({ ...payload, state: budget.state });
  const expected = decisionQuestions(payload.questions);
  if (!isRecord(choices) || Object.keys(choices).length !== Object.keys(expected).length || !Object.entries(expected).every(([name, question]) => Object.hasOwn(question.criteria, choices[name]))) throw new Error("native decision returned an invalid option");
  const nativeAnswers = Object.fromEntries(Object.entries(payload.questions).map(([name, question]) => {
    const criteria = question.type === "choice"
      ? question.criteria
      : question.type === "noul"
        ? { true: question.criteria?.true ?? "The answer is yes", false: question.criteria?.false ?? "The answer is no" }
        : Object.fromEntries(question.criteria.map((level, index) => [String(index), level]));
    const choice = choices[name];
    if (question.type === "noul") return [name, { type: "noul", noul: choice === "true" ? 1 : 0 }];
    const probabilities = Object.fromEntries(Object.keys(criteria).map((option) => [option, option === choice ? 1 : 0]));
    if (question.type === "choice") return [name, { type: "choice", choice, probabilities, confidence: 1 }];
    const legend = Object.fromEntries(question.criteria.map((level, index) => [String(index), typeof level === "string" ? level : JSON.stringify(level)]));
    return [name, { type: "score", score: Number(choice), legend, probabilities, confidence: 1 }];
  }));
  const performanceMetrics = { request_bytes: bodyBytes, state_bytes: budget.stats.original_bytes, budgeted_state_bytes: budget.stats.budgeted_bytes, state_truncated: budget.stats.truncated, omitted_array_items: budget.stats.omitted_array_items, worker_ms: workerMs, worker_round_trip_ms: roundTripMs, worker_queue_ms: Number(Math.max(0, roundTripMs - workerMs).toFixed(3)), ...questionMetrics(payload.questions) };
  return { model: "jev-local-fm-0.6", answers: nativeAnswers, usage: { input_tokens: 0, output_tokens: 0 }, metadata: { provider: "Apple Foundation Models native greedy decisions", confidence: "All probabilities are greedy point estimates, not Jev-calibrated", performance: performanceMetrics } };
}

export const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { status: "ok", fm_base_url: fmBaseUrl });
  if (request.method === "POST" && ["/v1/systemone", "/v1/decide"].includes(request.url)) {
    try { const { payload, bodyBytes } = await readJson(request); validateRequest(payload); const result = await decide(payload, bodyBytes); const p = result.metadata.performance; response.setHeader("server-timing", `fm-worker;dur=${p.worker_ms}, fm-queue;dur=${p.worker_queue_ms}`); return send(response, 200, result); }
    catch (error) { const message = error instanceof Error ? error.message : "Unknown error"; return apiError(response, message.startsWith("fm serve") || message.includes("structured output") || message.includes("adapter validation") ? 502 : 422, message); }
  }
  return apiError(response, 404, "Not found", "not_found_error");
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) server.listen(port, host, () => console.log(`jev-local listening on http://${host}:${port} → ${fmBaseUrl}`));
