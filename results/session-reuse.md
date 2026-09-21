# Session reuse

Date: 2026-09-22 (Asia/Tokyo)

The worker now keeps a `LanguageModelSession` for `JEV_SESSION_TURNS` requests (default 8). Instructions are a fixed role. `state` is in the user prompt, which is required for reuse because session instructions cannot change. After the cap, or after a generation error, it starts a blank session. Choice criteria are capped at 26 options.

BBQ Age first 100, failures counted as wrong:

| Setup | Overall | Ambiguous | Disambiguated | p50 |
| --- | ---: | ---: | ---: | ---: |
| Fresh session, single-letter schema | 76 / 100 | 35 / 50 | 41 / 50 | 259 ms |
| Reused session, 8 turns | **53 / 100** | **8 / 50** | **45 / 50** | 463 ms |

Reuse helped evidence-backed questions and hurt abstention: prior turns in the transcript push the model toward naming a person. Isolated eval can set `JEV_SESSION_TURNS=1`. Consecutive 2048 moves are the intended workload.
