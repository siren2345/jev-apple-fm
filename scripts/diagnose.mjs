import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail }); }
function command(command, args) { return spawnSync(command, args, { encoding: "utf8" }); }

check("macOS", process.platform === "darwin", process.platform);
check("Apple Silicon", process.arch === "arm64", process.arch);
const swift = command("swiftc", ["--version"]);
check("Swift compiler", swift.status === 0, swift.status === 0 ? swift.stdout.trim().split("\n")[0] : "swiftc unavailable");
const fm = command("fm", ["available"]);
check("Apple Foundation Models", fm.status === 0 && /available/i.test(fm.stdout), fm.stdout.trim() || fm.stderr.trim() || "fm unavailable");
check("Compiled worker", existsSync("fm_worker"), existsSync("fm_worker") ? "fm_worker present" : "Run: npm run build");

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}: ${item.detail}`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
