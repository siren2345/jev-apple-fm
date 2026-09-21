# Doom: local Foundation Models adapter vs. Jev

Date: 2026-09-22 (Asia/Tokyo)

## Method

The same `jev-doom-agent` scenario was used for each run: the default easy encounter, three initially visible enemies, and the default safety-first system prompt. The existing Doom controller, action translation, and structured game-state builder were unchanged.

The controller was given an optional local endpoint override only for this experiment. In the local run, `JEV_BASE_URL=http://127.0.0.1:8787` routed the original four Choice questions to `jev-local`; the original run used the TypeSafe Jev endpoint.

## Observed outcome

| Backend | First decision latency | Outcome |
| --- | ---: | --- |
| TypeSafe Jev | 733 ms (later calls mostly 236--487 ms) | 4 kills, 0 enemies, HP 27, armor 68 |
| Local Foundation Models adapter, four independent model processes | exceeded the controller's 6 s deadline | fallback control, 0 kills, death |
| Local Foundation Models adapter, one batched model session | 10,226 ms | 0 kills, death before the second decision |
| Local Foundation Models adapter, persistent prewarmed worker | 10,400 ms | 0 kills, death before the second decision |
| Local Foundation Models adapter, persistent worker plus generic state budget | 2,288 ms (later 1,671--1,911 ms) | 1 kill, death after 8 decisions, HP -1, armor 54, 2 enemies remaining |

The budgeted replay used the same four-axis request path. The first inbound `state` was 13,968 bytes; the API applied the default generic budget (2048-byte cap, no Doom-specific feature extraction) before native inference.

## Conclusion

The local adapter accepted and answered the same Jev-shaped four-axis request, but it is not yet viable for this real-time Doom controller. Process warmup did not change the 10.4 s full-state result. The generic state budget did: the same encounter produced eight in-time decisions and one kill, with later controller-observed latencies around 1.7 s. That is still several times slower than TypeSafe Jev (first 733 ms, later 236--487 ms, 4 kills and survival). Remaining cost is native inference on the budgeted prompt, including unbudgeted question instructions, not worker startup.

The controller's ordinary 6 s deadline was extended to 15 s only for the batched local observation. The external demo code and its local override were not committed to this repository.
