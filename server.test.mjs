import assert from "node:assert/strict";
import test from "node:test";
import { budgetState, decorateAnswers, responseSchema, validateRequest } from "./server.mjs";

const questions = {
  route: { type: "choice", instructions: "Which team owns this?", criteria: { billing: "Payments", support: "Technical issues" } },
  escalate: { type: "noul", instructions: "Should a human intervene immediately?" },
  urgency: { type: "score", instructions: "Rate urgency", criteria: ["Low", "Normal", "High", "Urgent"] },
};

test("accepts TypeSafe Choice, Noul, and Score request shapes", () => {
  assert.doesNotThrow(() => validateRequest({ model: "jev-latest", state: "Refund requested", questions }));
  assert.deepEqual(responseSchema(questions).required, ["route", "escalate", "urgency"]);
});
test("rejects invalid TypeSafe shapes", () => {
  assert.throws(() => validateRequest({ model: "jev-latest", state: "x", questions: { route: { type: "choice", instructions: "x", criteria: {} } } }));
  assert.throws(() => validateRequest({ model: "jev-latest", state: "x", questions: { score: { type: "score", instructions: "x", criteria: ["only one"] } } }));
  assert.throws(() => validateRequest({ state: "x", questions }));
});
test("returns Jev-shaped answers", () => {
  const answers = decorateAnswers({ route: { probabilities: { billing: 0.8, support: 0.2 } }, escalate: { noul: 0.7 }, urgency: { probabilities: { 0: 0, 1: 0.2, 2: 0.7, 3: 0.1 } } }, questions);
  assert.equal(answers.route.type, "choice"); assert.equal(answers.route.choice, "billing");
  assert.deepEqual(answers.escalate, { type: "noul", noul: 0.7 });
  assert.ok(Math.abs(answers.urgency.score - 1.9) < 1e-9); assert.equal(answers.urgency.legend["3"], "Urgent");
});
test("passes small state through the input budget unchanged", () => {
  const state = { player: { health: 100 }, combat: { visible_enemy_count: 3 } };
  const { state: budgeted, stats } = budgetState(state, { max_array_items: 16, max_string_chars: 160, max_object_keys: 32, max_depth: 6, max_bytes: 2048 });
  assert.deepEqual(budgeted, state);
  assert.equal(stats.truncated, false);
  assert.equal(stats.budgeted_bytes, stats.original_bytes);
});
test("caps long strings, long arrays, and deep objects without touching questions", () => {
  const limits = { max_array_items: 2, max_string_chars: 8, max_object_keys: 32, max_depth: 2, max_bytes: 2048 };
  const { state: budgeted, stats } = budgetState({ note: "abcdefghij", items: [1, 2, 3, 4], nested: { a: { b: { c: 1 } } } }, limits);
  assert.equal(budgeted.note, "abcdefgh");
  assert.deepEqual(budgeted.items, [1, 2, { _omitted: 2 }]);
  assert.deepEqual(budgeted.nested, { a: { _omitted: "max_depth" } });
  assert.equal(stats.truncated, true);
  assert.equal(stats.omitted_array_items, 2);
  assert.equal(stats.omitted_string_chars, 2);
  assert.doesNotThrow(() => validateRequest({ model: "jev-latest", state: budgeted, questions }));
});
test("tightens array and string caps until the byte budget fits", () => {
  const items = Array.from({ length: 40 }, (_, index) => ({ id: index, label: "x".repeat(80) }));
  const { stats } = budgetState({ items }, { max_array_items: 32, max_string_chars: 80, max_object_keys: 32, max_depth: 6, max_bytes: 400 });
  assert.equal(stats.truncated, true);
  assert.ok(stats.budgeted_bytes <= 400, `budgeted ${stats.budgeted_bytes} bytes`);
  assert.ok(stats.limits.max_array_items < 32 || stats.limits.max_string_chars < 80);
});
