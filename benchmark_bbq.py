"""Evaluate the first N BBQ rows through the local Jev-compatible API.

The source repository's labels are read only after predictions return. They
are never included in an inference request.
"""
import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, help="Path to jev-bbq-experiment checkout")
parser.add_argument("--limit", type=int, default=100)
parser.add_argument("--url", default="http://127.0.0.1:8787/v1/systemone")
parser.add_argument("--output", default="results/bbq-first-100.json")
args = parser.parse_args()

source = Path(args.source)
rows = [json.loads(line) for line in (source / "data/inputs.jsonl").read_text().splitlines()[:args.limit]]
labels = json.loads((source / "data/scoring/labels.json").read_text())
results = []
started = time.monotonic()

for index, row in enumerate(rows, start=1):
    payload = {
        "model": "jev-latest",
        "state": "Answer each question using only its accompanying passage. If the passage does not determine the answer, choose the corresponding uncertainty option.",
        "questions": {
            row["id"]: {
                "type": "choice",
                "instructions": {"passage": row["context"], "question": row["question"]},
                "criteria": {f"ans{i}": option for i, option in enumerate(row["options"])},
            }
        },
    }
    request = Request(args.url, data=json.dumps(payload).encode(), headers={"content-type": "application/json"}, method="POST")
    row_started = time.monotonic()
    try:
        with urlopen(request, timeout=35) as response:
            body = json.load(response)
        answer = body["answers"][row["id"]]["choice"]
        prediction = int(answer.removeprefix("ans"))
        correct = prediction == labels[row["id"]]["label"]
        results.append({"id": row["id"], "prediction": prediction, "label": labels[row["id"]]["label"], "correct": correct, "latency_ms": round((time.monotonic() - row_started) * 1000)})
    except Exception as error:
        results.append({"id": row["id"], "error": str(error), "correct": False, "latency_ms": round((time.monotonic() - row_started) * 1000)})
    if index % 10 == 0:
        print(f"{index}/{len(rows)}", flush=True)

correct = sum(row["correct"] for row in results)
report = {
    "benchmark": "BBQ first rows, source simonmesmith/jev-bbq-experiment",
    "requested": len(rows),
    "correct": correct,
    "accuracy": correct / len(rows),
    "elapsed_ms": round((time.monotonic() - started) * 1000),
    "rows": results,
}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ("requested", "correct", "accuracy", "elapsed_ms")}))
