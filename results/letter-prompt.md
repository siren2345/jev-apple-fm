# Internal A/B/C prompt

Date: 2026-09-22 (Asia/Tokyo)

HTTP `criteria` keys are unchanged. The worker prompt now matches [jev-single-decode](https://github.com/siren2345/jev-single-decode): options are listed as `A.` / `B.` / `C.` and the user turn ends with `Answer:`. Node maps letters back to the caller's keys. The `rationale` field is gone.

BBQ Age first 100 (`eval/data/bbq-100.jsonl`), failures counted as wrong:

| Prompt | Overall | Ambiguous | Disambiguated | p50 |
| --- | ---: | ---: | ---: | ---: |
| Classify-only | 58 / 100 | — | — | ~0.4 s |
| Compare-then-choose | 65 / 100 (7 timeouts) | 24 / 50 | 41 / 50 | 1.5 s |
| Internal A/B/C + `Answer:` | **74 / 100** | **33 / 50** | 41 / 50 | **386 ms** |

TypeSafe Jev on the full BBQ set is 97.3% (ambiguous 99.96%). jev-single-decode / Qwen3-4B on 10,000 BBQ rows is 88.4% (ambiguous 92.2%).
