# Local 2048 profiling note

This is a turn-based, single-Choice use case for the local API. It is not a
claim that the server contains a 2048 policy.

## Setup

- Local `jev-apple-fm` server, fresh Foundation Models session per turn.
- Existing local `jev2048` engine and seed 7.
- A maximum of 100 moves; valid directions only are supplied as Choice keys.
- No fallback decisions and no API/model failures in the recorded runs.

## One-seed input-format comparison

| Input profile | Moves | Score | Max tile | Mean request time | p50/p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original verbose state | 61 | 376 | 32 | 402 ms | 397 / 409 ms |
| Compact state with features | 74 | 500 | 32 | 347 ms | 344 / 361 ms |
| Minimal structured state | 74 | 500 | 32 | 319 ms | 317 / 326 ms |

The compact and minimal forms use exponent board values, valid moves, dynamic
move consequences, and short instructions. The minimal form omits duplicated
legend, last-move field, and derived feature prose. This single-seed result is
useful for latency profiling only; use multiple fixed seeds before judging game
quality or adopting a client prompt.

Run the representative API request with:

```sh
npm run benchmark -- fixtures/2048-choice.json 20
```
