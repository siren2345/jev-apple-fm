import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = JSON.parse(await readFile(new URL("../fixtures/api-contract.json", import.meta.url), "utf8"));
const port = 18900 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let child;

async function startServer() {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), JEV_WORKER_PATH: fileURLToPath(new URL("./fixtures/mock-fm-worker.mjs", import.meta.url)) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`test server did not start: ${output}`)), 5_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("listening on")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`test server exited ${code}: ${output}`)));
  });
}

before(startServer);
after(() => child?.kill());

async function post(path, payload) {
  const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { response, body: await response.json() };
}

test("health is loopback API health shape", async () => {
  const response = await fetch(base + "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", fm_base_url: "http://127.0.0.1:1976/v1" });
});

test("systemone preserves Jev-shaped answers and performance metadata", async () => {
  const { response, body } = await post("/v1/systemone", fixture.valid_request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("server-timing"), /fm-worker;dur=/);
  assert.deepEqual(body.answers.route, { type: "choice", choice: "billing", probabilities: { billing: 1, support: 0 }, confidence: 1 });
  assert.deepEqual(body.answers.escalate, { type: "noul", noul: 1 });
  assert.equal(body.answers.urgency.type, "score");
  assert.equal(body.answers.urgency.score, 0);
  assert.deepEqual(body.answers.urgency.legend, { "0": "Low", "1": "Normal", "2": "High" });
  assert.equal(body.metadata.performance.state_truncated, false);
  assert.deepEqual(body.metadata.performance.state_budget, { max_array_items: 16, max_string_chars: 160, max_object_keys: 32, max_depth: 6, max_bytes: 2048 });
});

test("session_id reuses an isolated worker transcript", async () => {
  const payload = { ...fixture.valid_request, session_id: "contract-session" };
  const first = await post("/v1/systemone", payload);
  const second = await post("/v1/systemone", payload);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.metadata.performance.session_reused, false);
  assert.equal(first.body.metadata.performance.session_turn, 1);
  assert.equal(second.body.metadata.performance.session_reused, true);
  assert.equal(second.body.metadata.performance.session_turn, 2);
});

test("decide alias and 26-choice boundary preserve caller keys", async () => {
  const criteria = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`option_${index}`, `Option ${index}`]));
  const payload = { model: "jev-latest", state: "x", questions: { pick: { type: "choice", instructions: "Pick one", criteria } } };
  const { response, body } = await post("/v1/decide", payload);
  assert.equal(response.status, 200);
  assert.equal(body.answers.pick.choice, "option_0");
  assert.equal(Object.keys(body.answers.pick.probabilities).length, 26);
  assert.equal(body.answers.pick.probabilities.option_25, 0);
});

test("large state reports generic budget truncation", async () => {
  const payload = structuredClone(fixture.valid_request);
  payload.state = { events: Array.from({ length: 40 }, (_, index) => ({ id: index, text: "x".repeat(300) })) };
  const { response, body } = await post("/v1/systemone", payload);
  assert.equal(response.status, 200);
  assert.equal(body.metadata.performance.state_truncated, true);
  assert.ok(body.metadata.performance.budgeted_state_bytes <= body.metadata.performance.state_budget.max_bytes);
  assert.ok(body.metadata.performance.omitted_array_items > 0);
});

test("invalid input and unknown paths use API errors", async () => {
  for (const payload of fixture.invalid_requests) {
    const { response, body } = await post("/v1/systemone", payload);
    assert.equal(response.status, 422);
    assert.equal(body.error.type, "invalid_request_error");
  }
  const response = await fetch(base + "/not-a-route");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { message: "Not found", type: "not_found_error" } });
});
