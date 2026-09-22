import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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

test("2048 payload can opt into an isolated session", () => {
  const payload = payloadFor([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "game-7");
  assert.equal(payload.session_id, "game-7");
});

test("checked-in 2048 fixture matches the legal moves of its board", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/2048-choice.json", import.meta.url), "utf8"));
  const board = fixture.state.board_exponents.map((row) => row.map((value) => value ? 2 ** value : 0));
  const expected = payloadFor(board);
  assert.deepEqual(fixture.state.valid_moves, expected.state.valid_moves);
  assert.deepEqual(Object.keys(fixture.questions.move.criteria), expected.state.valid_moves);
});
