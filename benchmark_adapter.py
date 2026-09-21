"""Run the public jev-test fixture suite against a compatible local endpoint.

Usage:
  JEV_CASES_DIR=/path/to/jev-test python3 benchmark_adapter.py
"""
import json
import os
import sys
import time
from urllib.request import Request, urlopen

sys.path.insert(0, os.environ["JEV_CASES_DIR"])
from cases import ALL_CASES

URL = os.environ.get("JEV_LOCAL_URL", "http://127.0.0.1:8787/v1/systemone")

def decide(state, questions):
    payload = json.dumps({"model": "jev-latest", "state": state, "questions": questions}).encode()
    request = Request(URL, data=payload, headers={"content-type": "application/json"}, method="POST")
    with urlopen(request, timeout=35) as response:
        return json.load(response)

def passed(answer, rule):
    if rule[0] == "choice":
        return answer["choice"] == rule[1]
    if rule[0] == "noul":
        return answer["noul"] > rule[2] if rule[1] == ">" else answer["noul"] < rule[2]
    return rule[1] <= answer["score"] <= rule[2]

results = []
checks = 0
passes = 0
started = time.monotonic()
for case in ALL_CASES:
    case_started = time.monotonic()
    try:
        body = decide(case["state"], case["questions"])
        row = {"name": case["name"], "latency_ms": round((time.monotonic() - case_started) * 1000), "checks": []}
        for key, rule in case["expect"].items():
            ok = passed(body["answers"][key], rule)
            checks += 1
            passes += ok
            row["checks"].append({"question": key, "pass": ok, "expected": rule, "actual": body["answers"][key]})
        results.append(row)
    except Exception as error:
        count = len(case["expect"])
        checks += count
        results.append({"name": case["name"], "error": str(error), "checks": [{"pass": False}] * count})

print(json.dumps({
    "source": "souvikr/jev-test public docs-derived suite",
    "checks": checks,
    "passed": passes,
    "failed": checks - passes,
    "accuracy": round(passes / checks, 4),
    "elapsed_ms": round((time.monotonic() - started) * 1000),
    "cases": results,
}, indent=2))
