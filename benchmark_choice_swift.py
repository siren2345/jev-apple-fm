"""Measure the native Swift Choice path against public jev-test fixtures."""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.environ["JEV_CASES_DIR"])
from cases import ALL_CASES

binary = os.path.join(os.path.dirname(__file__), "fm_choice")
checks = 0
passes = 0
rows = []
started = time.monotonic()

for case in ALL_CASES:
    for name, question in case["questions"].items():
        rule = case["expect"].get(name)
        if not rule or question["type"] != "choice":
            continue
        input_data = json.dumps({"state": case["state"], "instructions": question["instructions"], "criteria": question["criteria"]})
        call_started = time.monotonic()
        result = subprocess.run([binary], input=input_data, text=True, capture_output=True, timeout=35)
        checks += 1
        if result.returncode:
            rows.append({"case": case["name"], "error": result.stdout or result.stderr})
            continue
        actual = json.loads(result.stdout)["choice"]
        ok = actual == rule[1]
        passes += ok
        rows.append({"case": case["name"], "pass": ok, "expected": rule[1], "actual": actual, "latency_ms": round((time.monotonic() - call_started) * 1000)})

print(json.dumps({"checks": checks, "passed": passes, "accuracy": round(passes / checks, 4), "elapsed_ms": round((time.monotonic() - started) * 1000), "cases": rows}, indent=2))
