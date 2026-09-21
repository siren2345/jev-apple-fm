# Generic state input budget

Date: 2026-09-22 (Asia/Tokyo)

## Change

`server.mjs` now applies a domain-agnostic budget to `state` before the Swift worker runs. Questions, Choice keys, and the HTTP request shape are unchanged.

Default caps (override with `JEV_STATE_MAX_*`):

- 16 array items (prefix kept, remainder recorded as `_omitted`)
- 160 string characters
- 32 object keys
- depth 6
- 2048 serialized state bytes, tightening the caps above until the budget fits

Disable with `JEV_STATE_BUDGET=off`. This is not a game-specific feature extractor.

## Local measurement

The same four Choice axes were used for every run. The large fixture is `fixtures/large-nested-state.json`: 80 generic records plus long strings, 23,659 request bytes. Small fixture is `fixtures/four-axis-choice.json`.

| Workload | State bytes sent to the model | Warm worker p50 |
| --- | ---: | ---: |
| Small four-axis fixture | 60 (unchanged) | 752 ms |
| Large nested fixture, budget off | 23,167 | 5,138 ms |
| Large nested fixture, default budget | 1,382 | 875 ms |

The budgeted large fixture omitted 72 trailing array items and shortened long strings. Worker queue time stayed below 0.3 ms after warmup, so the gain is from smaller native inference input rather than queueing.

The earlier full Doom replay (10.400 s) was a different, still larger structured state. This measurement isolates input size on a generic fixture and does not re-run that game.
