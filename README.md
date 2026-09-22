# jev-apple-fm

An on-device, Jev-compatible decision API for Apple Foundation Models on Apple Silicon.

`jev-apple-fm` exposes TypeSafe-style `POST /v1/systemone` decisions for `choice`, `noul`, and `score`, then serves them from Apple's native Foundation Models framework. It is intended for one local Mac owner: no API key, cloud inference, or network listener is required.

This is a shape-compatible local experiment, not a TypeSafe Jev replacement. Typical latency is about 0.7–6 s depending on prompt size. Returned probabilities are greedy one-hot values, not calibrated. It can route a ticket or take a 2048 turn. It is not fast enough for real-time Doom.

> This is an unofficial compatibility implementation. It is not affiliated with TypeSafe AI. “Jev” is used only to describe request/response compatibility.

## What this repository contains

- `server.mjs`: loopback-only Jev-compatible HTTP API.
- `fm_worker.swift`: long-lived Foundation Models worker using JSON Lines over stdin/stdout.
- `POST /v1/systemone`: primary endpoint; `POST /v1/decide` is an alias.
- `GET /health`: local health check.
- `benchmark_request.mjs`: repeat a Jev-shaped fixture and report latency percentiles.

The API receives all questions in one request and generates a constrained, simultaneous decision frame. Choice is limited to 26 criteria keys. Each request gets a fresh `LanguageModelSession` transcript; state, questions, and choices live only in that request's user prompt. A single-question request constrains native output directly to one caller criteria key instead of a JSON object or an A–Z intermediary.

## Requirements

- An Apple Silicon Mac with Apple Foundation Models available on the installed macOS release.
- Xcode Command Line Tools with Swift (`swiftc`).
- Node.js 20 or newer.

Verify the local model runtime before installing:

```sh
fm available
swift --version
node --version
```

`fm available` must report that the system model is available. This project calls the native `FoundationModels` framework directly; it does not start `fm serve` and does not need an OpenAI-compatible server.

## Install and start

```sh
git clone https://github.com/siren2345/jev-apple-fm.git
cd jev-apple-fm

# No runtime npm packages are currently required, but this verifies Node setup.
npm install

# Check macOS/Apple Silicon/Swift/Foundation Models availability, then build.
npm run diagnose
npm run build
npm start
```

The server listens only on `http://127.0.0.1:8787` by default. Check it from a second terminal:

```sh
curl http://127.0.0.1:8787/health
```

Use `PORT=9000 npm start` to choose another loopback port. Avoid setting `HOST` beyond `127.0.0.1` unless you intentionally want to expose an unauthenticated local API.

## Request and response

```sh
curl http://127.0.0.1:8787/v1/systemone \
  -H 'content-type: application/json' \
  --data '{
    "model": "jev-latest",
    "state": "Customer says: I was charged twice and need a refund.",
    "questions": {
      "route": {"type": "choice", "instructions": "Which team should own this?", "criteria": {"billing": "Payments or refunds", "technical_support": "Product issue", "general": "Everything else"}},
      "escalate": {"type": "noul", "instructions": "Should a human intervene immediately?"},
      "urgency": {"type": "score", "instructions": "Rate urgency.", "criteria": ["Low", "Normal", "High", "Urgent"]}
    }
  }'
```

The response preserves question names and Choice criteria keys:

```json
{
  "model": "jev-local-fm-0.9",
  "answers": {
    "route": {"type": "choice", "choice": "billing", "probabilities": {"billing": 1, "technical_support": 0, "general": 0}, "confidence": 1},
    "escalate": {"type": "noul", "noul": 1},
    "urgency": {"type": "score", "score": 2, "legend": {"0": "Low", "1": "Normal", "2": "High", "3": "Urgent"}, "probabilities": {"0": 0, "1": 0, "2": 1, "3": 0}, "confidence": 1}
  }
}
```

## API compatibility and limits

| Feature | Status |
| --- | --- |
| `POST /v1/systemone` | Supported |
| `POST /v1/decide` | Supported alias |
| `choice` (1–26 criteria keys) | Supported |
| `noul` | Supported as a greedy 0 or 1 decision |
| `score` (2–10 ordered levels) | Supported as a greedy one-hot score |
| Calibrated probabilities | Not supported |
| Cloud API key | Not used |
| Generic `state` input budget | Supported; questions and Choice keys are never truncated |
| Optional local `session_id` | Supported; bounded transcript retention for one logical interaction |

This server is shape-compatible, not behavior-identical to Jev. Each probability distribution is a greedy point estimate: the selected answer is `1`, all alternatives are `0`, and `confidence` is therefore `1`. Do not treat these values as calibrated probabilities.

Before the Swift worker sees `state`, the API applies a generic budget: long strings are sliced, long arrays keep a prefix plus an `_omitted` count, objects deeper than the depth cap are replaced, and limits tighten until the serialized state fits `JEV_STATE_MAX_BYTES` (default 2048). This is not a domain-specific compressor. Disable it with `JEV_STATE_BUDGET=off`.

The default per-value limits are 16 array items, 160 string characters, 32 object keys, and depth 6. Override them with `JEV_STATE_MAX_ARRAY_ITEMS`, `JEV_STATE_MAX_STRING_CHARS`, `JEV_STATE_MAX_OBJECT_KEYS`, `JEV_STATE_MAX_DEPTH`, and `JEV_STATE_MAX_BYTES`. Successful responses report `state_bytes`, `budgeted_state_bytes`, `state_truncated`, omitted array/key/string counts, and the effective `state_budget` in `metadata.performance`; request content itself is never logged or persisted.

## Architecture

```text
client
  -> POST /v1/systemone on 127.0.0.1:8787
  -> Node compatibility, validation, and generic state budget
  -> persistent Swift JSONL worker
  -> Apple Foundation Models on-device runtime
```

The Swift worker keeps its process and model resources warm. Requests without `session_id` receive a fresh `LanguageModelSession` transcript, so state from one request cannot become conversation context for another. Apple controls underlying hardware scheduling; this project targets Apple Foundation Models on Apple Silicon rather than claiming exclusive direct control of the Neural Engine.

Pass an optional top-level `session_id` to retain a transcript for one logical interaction, such as a turn-based game. Sessions are local-worker-only, isolated by ID, retain at most four turns by default, and then restart automatically to bound context growth. `metadata.performance` reports `session_reused` and `session_turn`. Set `JEV_SESSION_MAX_TURNS` or `JEV_SESSION_MAX_COUNT` to tune those local limits. Omit `session_id` for the default fresh-session behavior.

## Profile and replay

Every successful response includes `metadata.performance` with request bytes, question/option counts, Swift inference time, worker queue time, and worker round-trip time. The same timings are exposed in the HTTP `Server-Timing` header.

With the server running, replay any Jev-shaped JSON request:

```sh
npm run benchmark -- fixtures/four-axis-choice.json 10
npm run benchmark -- fixtures/large-nested-state.json 3
npm run benchmark -- fixtures/2048-choice.json 20
npm run benchmark:2048 -- --seeds 1,7,42 --max-moves 100
npm run benchmark:2048 -- --seeds 7 --max-moves 50 --session
npm run eval -- tickets
npm run eval:tickets
npm run eval -- bbq --limit 10
npm run eval -- bbq --limit 100 --out results/bbq-100.json
```

The latency script prints p50/p95 without saving request content. `npm run eval` scores labeled cases over HTTP: `tickets` is five TypeSafe-style routing/noul items, `bbq` is the first 100 Age questions from [simonmesmith/jev-bbq-experiment](https://github.com/simonmesmith/jev-bbq-experiment) (50 ambiguous, 50 disambiguated). Use `--limit` for a faster loop. `--vs https://api.typesafe.ai/v1/systemone` compares against TypeSafe when `JEV_API_KEY` is set. Set `JEV_LOCAL_URL` to point either script at another local endpoint.

`npm run eval:tickets` is the contract regression gate: it requires all five labeled TypeSafe-shaped cases to succeed and have no HTTP/model errors. Any prompt or worker change should pass this gate before being adopted. Use `--expect-min-accuracy` and `--expect-max-errors` with either benchmark to set an explicit local acceptance threshold; BBQ is tracked quality, not a Jev-equivalence claim. The complete evaluation protocol is in [`results/evaluation-protocol.md`](results/evaluation-protocol.md).

BBQ Age first-100, failures counted as wrong: the current fresh-session run scored **0.79** (ambiguous 0.78, disambiguated 0.80; p50 318 ms; p95 354 ms; 0 API/model errors). For Choice questions with a mechanically recognized uncertainty option (for example “Cannot answer”, “Undetermined”, or “Not known”), the worker adds an uncertainty gate: choose that option unless stated facts directly establish another option. This is an Apple FM-specific evaluation result, not a claim of Jev-equivalent reasoning. Re-run `npm run eval -- bbq --limit 100` after prompt changes.

Current small-fixture baseline: warm worker inference was approximately 719–752 ms for a 630-byte request with four questions and eight options. A 23,659-byte nested-state fixture dropped from about 5.1 s unbudgeted to 865–877 ms after the generic state budget. The same Doom encounter completed eight decisions at 1.67–2.29 s and scored one kill, but still died; it is not a real-time-game backend. See [`results/`](results/) for methodology; results depend on request size, macOS version, and hardware.

For turn-based tasks, smaller structured state is materially faster. The included [`fixtures/2048-choice.json`](fixtures/2048-choice.json) is a compact 2048-style request: exponent board, valid moves, and per-move consequences, without duplicated prose or derived features. In a local 2048 harness it reduced one observed game's median decision time to about 317 ms while retaining its outcome; see [`results/2048-local-benchmark.md`](results/2048-local-benchmark.md). That is a profiling example, not a general accuracy claim or a game-specific server policy.

## Development

```sh
npm test
npm run diagnose
npm run build
```

`npm test` includes a fast HTTP contract suite backed by a deterministic JSONL
worker. It checks the two endpoint names, Jev-shaped answer fields, the
1–26 Choice boundary, generic state-budget metadata, and 4xx error shapes
without depending on model quality or Apple FM latency. The Apple FM
integration gate remains `npm run eval:tickets` with a built worker and a
running local server.

The API is intentionally loopback-only and unauthenticated. Keep side effects outside the model branch and validate caller input before using a returned decision.
