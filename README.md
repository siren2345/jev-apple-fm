# jev-apple-fm

An on-device, Jev-compatible decision API for Apple Foundation Models on Apple Silicon.

`jev-apple-fm` exposes TypeSafe-style `POST /v1/systemone` decisions for `choice`, `noul`, and `score`, then serves them from Apple's native Foundation Models framework. It is intended for one local Mac owner: no API key, cloud inference, or network listener is required.

> This is an unofficial compatibility implementation. It is not affiliated with TypeSafe AI. “Jev” is used only to describe request/response compatibility.

## What this repository contains

- `server.mjs`: loopback-only Jev-compatible HTTP API.
- `fm_worker.swift`: long-lived Foundation Models worker using JSON Lines over stdin/stdout.
- `POST /v1/systemone`: primary endpoint; `POST /v1/decide` is an alias.
- `GET /health`: local health check.
- `benchmark_request.mjs`: repeat a Jev-shaped fixture and report latency percentiles.

The API receives all questions in one request and generates a constrained, simultaneous decision frame. Internally it uses `DynamicGenerationSchema` plus greedy decoding, so a returned Choice is guaranteed to be one of the submitted criteria keys.

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
  "model": "jev-local-fm-0.4",
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
| `choice` (1–255 criteria keys) | Supported |
| `noul` | Supported as a greedy 0 or 1 decision |
| `score` (2–10 ordered levels) | Supported as a greedy one-hot score |
| Calibrated probabilities | Not supported |
| Cloud API key | Not used |

This server is shape-compatible, not behavior-identical to Jev. Each probability distribution is a greedy point estimate: the selected answer is `1`, all alternatives are `0`, and `confidence` is therefore `1`. Do not treat these values as calibrated probabilities.

## Architecture

```text
client
  -> POST /v1/systemone on 127.0.0.1:8787
  -> Node compatibility and validation layer
  -> persistent Swift JSONL worker
  -> Apple Foundation Models on-device runtime
```

The Swift worker keeps its process and model resources warm. Each HTTP request receives a fresh `LanguageModelSession` transcript, so state from one request cannot become conversation context for another. Apple controls underlying hardware scheduling; this project targets Apple Foundation Models on Apple Silicon rather than claiming exclusive direct control of the Neural Engine.

## Profile and replay

Every successful response includes `metadata.performance` with request bytes, question/option counts, Swift inference time, worker queue time, and worker round-trip time. The same timings are exposed in the HTTP `Server-Timing` header.

With the server running, replay any Jev-shaped JSON request:

```sh
npm run benchmark -- fixtures/four-axis-choice.json 10
```

The script prints p50/p95 end-to-end, worker, and queue latency without saving request content. Set `JEV_LOCAL_URL` to point it at another local endpoint.

Current small-fixture baseline: warm worker inference was approximately 734–754 ms for a 630-byte request with four questions and eight options. See [`results/`](results/) for methodology and the Doom comparison; results depend on request size, macOS version, and hardware.

## Development

```sh
npm test
swiftc -parse-as-library fm_worker.swift -o fm_worker
```

The API is intentionally loopback-only and unauthenticated. Keep side effects outside the model branch and validate caller input before using a returned decision.
