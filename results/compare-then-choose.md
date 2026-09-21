# Compare-then-choose prompt

Date: 2026-09-22 (Asia/Tokyo)

`fm_worker.swift` now asks the on-device model to write a short option comparison (`rationale`) before it emits constrained Choice keys. Criteria text is copied into the prompt body. Sampling stays greedy; returned HTTP probabilities stay one-hot.

This is not a game-specific policy. It trades latency for a more considered pick.

## 2048, seed 1, same opening board

| Backend | First move | Later pattern | 8-move score | Move latency |
| --- | --- | --- | ---: | --- |
| Local FM, classify-only prompt | `up` | almost always `up` | 20, max 8 | ~0.5–1.2 s |
| Local FM, compare-then-choose | `left` | left / down / right mix | 20, max 8 | ~3.3–5.9 s |
| TypeSafe Jev 1.13.0 | `left` | left / right | 16, max 4 | ~0.19–0.49 s |

Three ticket-routing fixtures (refund, Safari crash, seat pricing) mapped to billing / technical / sales after the change.

Boards diverge after the first move, so the 8-move scores are not a skill ranking.
