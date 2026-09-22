import { pathToFileURL } from "node:url";

const directions = ["up", "down", "left", "right"];

function clone(board) { return board.map((row) => [...row]); }
function slideLeft(row) {
  const compact = row.filter(Boolean);
  const out = [];
  let gained = 0;
  for (let index = 0; index < compact.length; index += 1) {
    if (compact[index] === compact[index + 1]) { const value = compact[index] * 2; out.push(value); gained += value; index += 1; }
    else out.push(compact[index]);
  }
  return { row: [...out, ...Array(4 - out.length).fill(0)], gained };
}
export function previewMove(board, direction) {
  const out = clone(board);
  let gained = 0;
  if (direction === "left" || direction === "right") {
    for (let row = 0; row < 4; row += 1) {
      const source = direction === "right" ? [...out[row]].reverse() : out[row];
      const result = slideLeft(source); gained += result.gained;
      out[row] = direction === "right" ? result.row.reverse() : result.row;
    }
  } else {
    for (let column = 0; column < 4; column += 1) {
      const source = Array.from({ length: 4 }, (_, row) => out[row][column]);
      const result = slideLeft(direction === "down" ? source.reverse() : source); gained += result.gained;
      const row = direction === "down" ? result.row.reverse() : result.row;
      for (let index = 0; index < 4; index += 1) out[index][column] = row[index];
    }
  }
  return { board: out, gained, moved: JSON.stringify(out) !== JSON.stringify(board) };
}
function emptyCells(board) { return board.flatMap((row, r) => row.flatMap((value, c) => value ? [] : [[r, c]])); }
function validMoves(board) { return directions.filter((direction) => previewMove(board, direction).moved); }
function maxTile(board) { return Math.max(...board.flat()); }
function exponents(board) { return board.map((row) => row.map((value) => value ? Math.log2(value) : 0)); }
function rng(seed) { let state = seed >>> 0; return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; }; }
function spawn(board, random) { const cells = emptyCells(board); if (!cells.length) return; const [row, column] = cells[Math.floor(random() * cells.length)]; board[row][column] = random() < 0.1 ? 4 : 2; }

export function payloadFor(board) {
  const moves = validMoves(board);
  const criteria = Object.fromEntries(moves.map((direction) => {
    const result = previewMove(board, direction);
    const emptyAfterSpawn = Math.max(0, emptyCells(result.board).length - 1);
    return [direction, `Slide ${direction}: merges ${result.gained} points, about ${emptyAfterSpawn} empty cells afterwards`];
  }));
  return {
    model: "jev-latest",
    state: { game: "2048", board_exponents: exponents(board), valid_moves: moves },
    questions: { move: { type: "choice", instructions: "Play 2048. Keep the largest tile in a corner, keep rows descending toward that corner, preserve empty cells, and avoid immediate reverse moves. Choose only a valid move.", criteria } },
  };
}

function percentile(values, fraction) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null; }
export async function runGame(seed, endpoint, maxMoves = 100) {
  const random = rng(seed); const board = Array.from({ length: 4 }, () => Array(4).fill(0)); spawn(board, random); spawn(board, random);
  let score = 0; let moves = 0; const latencies = [];
  while (moves < maxMoves) {
    const payload = payloadFor(board); const valid = payload.state.valid_moves;
    if (!valid.length) break;
    const started = performance.now();
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); const latency = performance.now() - started;
    if (!response.ok) throw new Error(`seed ${seed}, move ${moves}: ${JSON.stringify(body)}`);
    const choice = body.answers?.move?.choice;
    if (!valid.includes(choice)) throw new Error(`seed ${seed}, move ${moves}: invalid choice ${choice}`);
    const result = previewMove(board, choice); board.splice(0, board.length, ...result.board); score += result.gained; moves += 1; spawn(board, random); latencies.push(latency);
  }
  return { seed, moves, score, max_tile: maxTile(board), over: validMoves(board).length === 0, latency_ms: { p50: Number(percentile(latencies, .5).toFixed(1)), p95: Number(percentile(latencies, .95).toFixed(1)), mean: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)) } };
}

function options() {
  const args = process.argv.slice(2); const out = { endpoint: process.env.JEV_LOCAL_URL ?? "http://127.0.0.1:8787/v1/systemone", seeds: [1, 7, 42], maxMoves: 100 };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--seeds") { out.seeds = args[++index].split(",").map(Number); }
    else if (args[index] === "--max-moves") out.maxMoves = Number(args[++index]);
    else if (args[index] === "--url") out.endpoint = args[++index];
  }
  if (!out.seeds.length || !out.seeds.every(Number.isInteger) || !Number.isInteger(out.maxMoves) || out.maxMoves < 1) throw new Error("Usage: node benchmark_2048.mjs [--seeds 1,7,42] [--max-moves 100] [--url URL]");
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = options(); const games = [];
  for (const seed of config.seeds) { const game = await runGame(seed, config.endpoint, config.maxMoves); games.push(game); console.error(`2048 seed=${seed} moves=${game.moves} score=${game.score} max=${game.max_tile}`); }
  const aggregate = (key) => Number((games.reduce((sum, game) => sum + game[key], 0) / games.length).toFixed(1));
  console.log(JSON.stringify({ endpoint: config.endpoint, max_moves: config.maxMoves, games, aggregate: { games: games.length, moves_mean: aggregate("moves"), score_mean: aggregate("score"), max_tile: Math.max(...games.map((game) => game.max_tile)), latency_ms: { p50: percentile(games.map((game) => game.latency_ms.p50), .5), p95: percentile(games.map((game) => game.latency_ms.p95), .95) } } }, null, 2));
}
