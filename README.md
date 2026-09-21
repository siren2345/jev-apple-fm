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

The API receives all questions in one request and generates a constrained, simultaneous decision frame. Internally it uses `DynamicGenerationSchema` plus greedy decoding, so a returned Choice is guaranteed to be one of the submitted criteria keys. Choice is limited to 26 options (`A`–`Z`). The worker reuses a `LanguageModelSession` for a short run of requests: instructions are a fixed role, and `state` goes in the user prompt. Consecutive requests can see prior turns until the worker starts a fresh session. HTTP criteria keys are unchanged. A single-question request constrains the native output to one letter instead of a JSON object.

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

# Compile the persistent on-device decision worker.
swiftc -parse-as-library fm_worker.swift -o fm_worker

# No runtime npm packages are currently required, but this verifies Node setup.
npm install
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

This server is shape-compatible, not behavior-identical to Jev. Each probability distribution is a greedy point estimate: the selected answer is `1`, all alternatives are `0`, and `confidence` is therefore `1`. Do not treat these values as calibrated probabilities.

Before the Swift worker sees `state`, the API applies a generic budget: long strings are sliced, long arrays keep a prefix plus an `_omitted` count, objects deeper than the depth cap are replaced, and limits tighten until the serialized state fits `JEV_STATE_MAX_BYTES` (default 2048). This is not a domain-specific compressor. Disable it with `JEV_STATE_BUDGET=off`. Successful responses report `state_bytes`, `budgeted_state_bytes`, and `state_truncated` in `metadata.performance`.

## Architecture

```text
client
  -> POST /v1/systemone on 127.0.0.1:8787
  -> Node compatibility, validation, and generic state budget
  -> persistent Swift JSONL worker
  -> Apple Foundation Models on-device runtime
```

The Swift worker keeps its process and model resources warm. Each HTTP request receives a fresh `LanguageModelSession` transcript, so state from one request cannot become conversation context for another. Apple controls underlying hardware scheduling; this project targets Apple Foundation Models on Apple Silicon rather than claiming exclusive direct control of the Neural Engine.

## Profile and replay

Every successful response includes `metadata.performance` with request bytes, question/option counts, Swift inference time, worker queue time, and worker round-trip time. The same timings are exposed in the HTTP `Server-Timing` header.

With the server running, replay any Jev-shaped JSON request:

```sh
npm run benchmark -- fixtures/four-axis-choice.json 10
npm run benchmark -- fixtures/large-nested-state.json 3
npm run eval -- tickets
npm run eval -- bbq --limit 10
npm run eval -- bbq --limit 100 --out results/bbq-100.json
```

The latency script prints p50/p95 without saving request content. `npm run eval` scores labeled cases over HTTP: `tickets` is five TypeSafe-style routing/noul items, `bbq` is the first 100 Age questions from [simonmesmith/jev-bbq-experiment](https://github.com/simonmesmith/jev-bbq-experiment) (50 ambiguous, 50 disambiguated). Use `--limit` for a faster loop. `--vs https://api.typesafe.ai/v1/systemone` compares against TypeSafe when `JEV_API_KEY` is set. Set `JEV_LOCAL_URL` to point either script at another local endpoint.

BBQ Age first-100, failures counted as wrong: single-letter schema with a fresh session **0.76** (ambiguous 0.70, disambiguated 0.82). Reusing a session for 8 turns dropped that to **0.53** (ambiguous 0.16, disambiguated 0.90) because earlier answers leak. Set `JEV_SESSION_TURNS=1` for isolated eval. Re-run `npm run eval -- bbq --limit 100` after prompt changes.

Current small-fixture baseline (before the compare-then-choose prompt): warm worker inference was approximately 719–752 ms for a 630-byte request with four questions and eight options. A 23,659-byte nested-state fixture dropped from about 5.1 s unbudgeted to 865–877 ms after the generic state budget. The same Doom encounter that previously died before a second 10.4 s decision then completed eight decisions at 1.67–2.29 s and scored one kill; it still died. After the compare-then-choose prompt and a system/user split (`state` in session instructions, questions in the user turn), a seed-1 2048 opening matched TypeSafe Jev's first move (`left` instead of a stuck `up`) at about 3–6 s per move. See [`results/`](results/) for methodology; results depend on request size, macOS version, and hardware.

## Development

```sh
npm test
swiftc -parse-as-library fm_worker.swift -o fm_worker
```

The API is intentionally loopback-only and unauthenticated. Keep side effects outside the model branch and validate caller input before using a returned decision.
