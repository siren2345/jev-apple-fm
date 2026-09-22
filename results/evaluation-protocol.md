# Evaluation protocol

This project preserves Jev endpoint and JSON shape compatibility, not Jev's
context window or reasoning algorithm. Evaluation therefore separates API
regressions from model-quality measurements.

## Contract gate

Start a locally built server, then run:

```sh
npm test
npm run eval:tickets
```

`tickets` contains five deterministic TypeSafe-shaped `choice` and `noul`
requests. The gate requires accuracy `1.0` and zero transport/model errors.
It detects request validation, key mapping, response decoration, and worker
integration regressions. It does not establish general reasoning ability.

## Quality benchmark

Run the fixed BBQ Age first-100 set with a fresh worker build:

```sh
npm run eval -- bbq --limit 100 --expect-max-errors 0
```

Record accuracy separately for `ambig` and `disambig` conditions, latency
p50/p95, macOS version, and hardware. The current recorded run for the
single-letter, fresh-session prompt is 0.69 overall (0.56 ambiguous, 0.82
disambiguated; p50 290 ms; zero API/model errors). Prior 0.66 and 0.76 runs
are kept as history rather than treated as stable targets. These are local
Apple FM measurements, not release gates.

## Prompt-change rule

For every candidate prompt, run the contract gate and the same 100 BBQ rows
with the same state-budget environment. Adopt a prompt only when it passes the
contract gate and its quality/latency tradeoff is explicitly preferable. Do
not use saved session state: every HTTP request must use a fresh Foundation
Models session.

## State-budget reporting

For large-state tests, retain `metadata.performance` only: original and
budgeted byte counts, truncation counts, and effective limits. Do not commit
caller state or API secrets in evaluation artifacts.
