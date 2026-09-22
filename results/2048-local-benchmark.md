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

For fixed-seed game-quality regression, use the repository harness:

```sh
npm run benchmark:2048 -- --seeds 1,7,42 --max-moves 100
```

It contains the game mechanics solely to make the API benchmark reproducible;
the API itself receives only an ordinary `choice` request and has no 2048
branch.

## Current fixed-seed baseline

The first harness run used the minimal profile above. Seed 7 ended after 40
moves at tile 16; seed 1 ended after 80 moves at tile 64; seed 42 reached tile
64 after 80 moves and was still active. Warm request p50 was 318–323 ms.

This establishes that turn latency is practical but Apple FM greedy choice is
not yet a practical standalone 2048 policy. Do not present the fixture as a
2048 solver. A future quality change must improve this fixed-seed suite without
weakening the generic API contract; a deterministic game policy, if desired,
belongs in a client rather than in this API server.

## Prompt experiments

Directly constraining native output to the caller's option key (rather than an
internal A–Z letter) with no global uncertainty instruction improved seed 7
from 40 moves/tile 16 to 49 moves/tile 32 in one fixed run, at p50 325 ms.
Moving state into session instructions did not show a distinct advantage over
that change. Adding largest-tile, empty-cell, and last-move annotations as one
bundle regressed the same seed to 40 moves/tile 16 and p50 351 ms, so it was
not adopted. An internal `choice + rationale` schema matched the normal mode's
first ten moves but raised single-request p50 from about 328 ms to about
1,397 ms; it was also not adopted.

## Bounded session experiment

An optional `session_id` retains an isolated Foundation Models transcript. An
unbounded 24-turn session exceeded the interactive benchmark timeout. Resetting
after four turns gave a useful compromise: seed 7 reached 144 points/tile 32
after 24 moves and 324 points/tile 32 after 50 moves, at roughly 534–536 ms
p50. The equivalent fresh 24-turn run scored 56 points/tile 8. This is a
single-seed signal rather than a solver-quality claim; the default remains a
fresh session unless the caller supplies `session_id`.
