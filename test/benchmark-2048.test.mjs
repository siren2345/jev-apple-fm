import assert from "node:assert/strict";
import test from "node:test";
import { payloadFor, previewMove } from "../benchmark_2048.mjs";

test("2048 preview merges once and keeps the input board unchanged", () => {
  const board = [[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const result = previewMove(board, "left");
  assert.deepEqual(result.board[0], [4, 4, 0, 0]);
  assert.equal(result.gained, 8);
  assert.deepEqual(board[0], [2, 2, 2, 2]);
});

test("2048 fixture only offers legal Choice keys", () => {
  const board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]];
  const payload = payloadFor(board);
  assert.deepEqual(Object.keys(payload.questions.move.criteria), payload.state.valid_moves);
  assert.ok(payload.state.valid_moves.length > 0);
});
