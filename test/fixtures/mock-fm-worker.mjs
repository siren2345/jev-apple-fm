#!/usr/bin/env node
import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    const choices = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, question.options[0].letter]));
    process.stdout.write(JSON.stringify({ id: request.id, choices, worker_ms: 1 }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ id: "unknown", error: "Invalid mock request" }) + "\n");
  }
});
