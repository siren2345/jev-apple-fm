# Single-question letter schema

Date: 2026-09-22 (Asia/Tokyo)

When the request has one question, the worker constrains the native output to a string `anyOf` A/B/C and does not embed the schema in the prompt. Multi-question requests still generate a JSON object of letters. HTTP criteria keys are mapped back in Node.

BBQ Age first 100, failures counted as wrong:

| Prompt | Overall | Ambiguous | Disambiguated | p50 |
| --- | ---: | ---: | ---: | ---: |
| A/B/C inside a JSON object | 74 / 100 | 33 / 50 | 41 / 50 | 386 ms |
| Single-letter schema | **76 / 100** | **35 / 50** | 41 / 50 | **259 ms** |
