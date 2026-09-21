# Request profiling baseline

Date: 2026-09-22 (Asia/Tokyo)

`npm run benchmark -- fixtures/four-axis-choice.json 3` was run against the persistent local worker.

| Metric | Observed value |
| --- | ---: |
| Request size | 630 bytes |
| Questions / options | 4 / 8 |
| End-to-end p50 | 756.813 ms |
| Worker inference p50 | 754.337 ms |
| Worker queue p50 | 0.295 ms |
| End-to-end p95 | 1,588.166 ms |

The first request included worker readiness overhead. The two later samples had worker inference of 754.337 ms and 734.127 ms, with queue time below 0.3 ms. This is a generic baseline fixture, not a gameplay workload.
