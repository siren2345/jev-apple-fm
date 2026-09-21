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

## Conclusion

The local adapter accepted and answered the same Jev-shaped four-axis request, but it is not yet viable for this real-time Doom controller. The decisive gap is end-to-end latency on the full structured game state, not schema compatibility: even the batched native session was about 14x slower than the observed first Jev call and arrived too late to prevent death.

The controller's ordinary 6 s deadline was extended to 15 s only for the batched local observation. The external demo code and its local override were not committed to this repository.
