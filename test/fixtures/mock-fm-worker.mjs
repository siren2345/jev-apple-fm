#!/usr/bin/env node
import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
const sessions = new Map();
input.on("line", (line) => {
  try {
    const request = JSON.parse(line);
    const choices = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, question.options[0].key]));
    const priorTurns = request.session_id ? (sessions.get(request.session_id) ?? 0) : 0;
    const sessionTurn = request.session_id ? priorTurns + 1 : 0;
    if (request.session_id) sessions.set(request.session_id, sessionTurn);
    process.stdout.write(JSON.stringify({ id: request.id, choices, worker_ms: 1, session_reused: priorTurns > 0, session_turn: sessionTurn }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ id: "unknown", error: "Invalid mock request" }) + "\n");
  }
});
