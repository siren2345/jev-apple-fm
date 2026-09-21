# Jev Doom Agent live test

Date: 2026-09-21 (Asia/Tokyo)

Repository tested: https://github.com/lukaske/jev-doom-agent

## Setup

- Cloned under `third_party/jev-doom-agent` (intentionally ignored; it is an external dependency, not project source).
- Ran `npm install`, `npm test` (4 passing), and `npm run build` successfully.
- Launched `npm start` with `TYPESAFE_API_KEY` populated in process memory from the locally configured `JEV_API_KEY`. The key was not printed, written to a file, or committed.

## Live run

- The game UI reported `LIVE AI CONTROL` and the local `/api/key` status was configured.
- The agent made successful upstream decisions. Typical observed latency was roughly 236--733 ms.
- It issued coordinated decision frames including `RETREAT_FROM_ENEMY`, `FACE_ENEMY`, `FIRE`, `SCAN`, and `COLLECT_NEAREST_PICKUP`.
- At the end of the observed combat encounter: **4 kills**, **0 enemies visible**, **HP 27**, **armor 68**.
- Live requests were explicitly stopped after the observation. The server was then terminated.

## Caveat

After the encounter had no enemies, the app continued to poll for decisions rather than recognizing a terminal state. This is a behavior/cost concern in the external demo, not a failure of the TypeSafe request path.
