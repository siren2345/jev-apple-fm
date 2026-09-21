# Uncertainty veto

Date: 2026-09-22 (Asia/Tokyo)

When a Choice includes an uncertainty-like option (`Unknown`, `Can't be determined`, …), the adapter still answers with the normal A/B/C prompt. If that pick is a specific option, a second internal question asks whether the passage supports it without outside knowledge. A `no` replaces the pick with the uncertainty key. HTTP criteria keys are unchanged. Disable with `JEV_UNCERTAINTY_GATE=off`.

A first version asked “is this determined?” *before* the Choice. That collapsed to always-unknown (ambiguous 5/5, disambiguated 0/5 on a 10-question slice). The veto-after-choice order is the one measured below.

BBQ Age first 100, failures counted as wrong:

| Prompt | Overall | Ambiguous | Disambiguated | p50 |
| --- | ---: | ---: | ---: | ---: |
| Internal A/B/C only | 74 / 100 | 33 / 50 | 41 / 50 | 386 ms |
| A/B/C + uncertainty veto | **82 / 100** | **45 / 50** | 37 / 50 | 407 ms |

The veto trades some evidence-backed answers for fewer stereotype guesses. Tickets without an uncertainty option still take one worker call.

This gate was reverted. It over-corrected: ambiguous accuracy rose, but evidence-backed answers fell, and a prior “is this determined?” pass collapsed to always-unknown. Current `main` is the internal A/B/C prompt without a second pass.
