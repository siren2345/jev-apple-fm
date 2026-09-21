# jev-local

A single-user, local-only System One-style decision API backed directly by Apple's on-device Foundation Models API.

It implements TypeSafe's public request and answer shapes for `Choice`, `Noul`, and `Score`, but it is **not** Jev: it uses greedy, native constrained decisions and emits point-estimate distributions rather than calibrated probabilities.

## Run

```sh
swiftc -parse-as-library fm_choice.swift -o fm_choice
npm start
```

The adapter binds only to `127.0.0.1:8787` by default. Set `PORT` or `HOST` only when intentionally changing that local topology.

## Request

```sh
curl http://127.0.0.1:8787/v1/systemone \
  -H 'content-type: application/json' \
  --data '{
    "model": "jev-latest",
    "state": "Customer says: I was charged twice and need a refund.",
    "questions": {
      "route": {
        "type": "choice",
        "instructions": "Which team should own this?",
        "criteria": {"billing": "Payments or refunds", "technical_support": "Product issue", "general": "Everything else"}
      },
      "escalate": {
        "type": "noul",
        "instructions": "Should a human intervene immediately?"
      },
      "urgency": {
        "type": "score",
        "instructions": "Rate urgency.",
        "criteria": ["Low", "Normal", "High", "Urgent"]
      }
    }
  }'
```

`choice.criteria` is a map of 1–255 named options. `noul` returns a value in `[0, 1]`. `score.criteria` is an ordered list of 2–10 levels, and returns their probability-weighted, zero-indexed mean.

## Safety and reliability boundary

- The adapter uses the native Swift Foundation Models API with dynamic enum constraints and greedy decoding. Choice and Score distributions are point estimates (selected option 1, all others 0); Noul is 0 or 1. They are not calibrated probabilities.
- The model receives state as data, not instructions, but it remains an LLM. Validate input and keep sensitive side effects outside the model branch.
- Bind to loopback only. This server has no authentication because it is designed for one local machine owner.
