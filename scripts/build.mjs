import { spawnSync } from "node:child_process";

const result = spawnSync("swiftc", ["-parse-as-library", "fm_worker.swift", "-o", "fm_worker"], { stdio: "inherit" });
if (result.error) {
  console.error("Could not run swiftc. Install Xcode Command Line Tools, then retry.");
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
