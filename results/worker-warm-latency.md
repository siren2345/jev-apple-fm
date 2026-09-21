# Persistent Foundation Models worker latency

Date: 2026-09-22 (Asia/Tokyo)

## Change

`server.mjs` now sends multi-axis requests to one long-lived Swift JSON Lines worker (`fm_worker`). The worker holds the `SystemLanguageModel` process and prewarms its resources once. It deliberately creates a fresh `LanguageModelSession` for every request: reusing a session would retain its transcript and violate the stateless API boundary.

## Local measurement

Three sequential HTTP requests used the same small structured state and four Choice axes.

| Request | End-to-end latency |
| --- | ---: |
| First request | 1,141 ms |
| Second request | 705 ms |
| Third request | 712 ms |

This improves on the prior one-shot child-process measurement of roughly 1.9 s for an equivalent small request. It does not resolve the separate full-Doom-state result (10.226 s); that remains the next generic performance bottleneck to measure.
