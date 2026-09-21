import assert from "node:assert/strict";
import test from "node:test";
import { decorateAnswers, responseSchema, validateRequest } from "./server.mjs";

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
