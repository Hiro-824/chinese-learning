import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Chess } from "chess.js";
import {
  DEFAULT_DIFFICULTY, ENGINE_MOVE_TIME, MAX_ENGINE_ELO, MIN_ENGINE_ELO,
  difficultyToElo, getDifficultyCommands, parseSavedDifficulty,
} from "./difficulty.ts";

test("slider endpoints and intermediate values map monotonically to supported Elo targets", () => {
  assert.equal(difficultyToElo(0), MIN_ENGINE_ELO);
  assert.equal(difficultyToElo(50), 2255);
  assert.equal(difficultyToElo(100), MAX_ENGINE_ELO);
  let previous = difficultyToElo(0);
  for (let step = 1; step <= 1000; step++) {
    const elo = difficultyToElo(step / 10);
    assert.ok(Number.isInteger(elo));
    assert.ok(elo > previous, `difficulty ${step / 10} must increase the target`);
    previous = elo;
  }
  assert.equal(difficultyToElo(-10), MIN_ENGINE_ELO);
  assert.equal(difficultyToElo(110), MAX_ENGINE_ELO);
  assert.equal(difficultyToElo(NaN), difficultyToElo(DEFAULT_DIFFICULTY));
});

test("saved difficulty migrates old settings and preserves zero and fractional values", () => {
  for (const [stored, expected] of [["beginner", 0], ["intermediate", 50], ["advanced", 90],
    ["0", 0], ["100", 100], ["42.5", 42.5], ["42.555", 42.6]]) {
    assert.equal(parseSavedDifficulty(stored), expected);
    assert.equal(parseSavedDifficulty(String(expected)), expected);
  }
  for (const invalid of [null, "", " ", "NaN", "Infinity", "-1", "100.1", "unknown", "constructor", "null"]) {
    assert.equal(parseSavedDifficulty(invalid), null);
  }
});

test("bundled engine accepts slider settings and returns legal moves at low, fractional and high difficulty", { timeout: 20000 }, async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../public/stockfish/stockfish-19-lite-single.js", import.meta.url))]);
  const reader = createInterface({ input: child.stdout });
  let pending;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  reader.on("line", (line) => {
    if (!pending) return;
    pending.lines.push(line);
    if (pending.matches(line)) {
      const { resolve, lines, timer } = pending;
      pending = undefined;
      clearTimeout(timer);
      resolve(lines);
    }
  });
  const fail = (error) => {
    if (!pending) return;
    const { reject, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    reject(error);
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`Engine exited (${code}): ${stderr}`)));
  t.after(() => {
    fail(new Error("Engine test finished"));
    reader.close();
    child.kill();
  });
  function sendUntil(commands, matches) {
    assert.equal(pending, undefined);
    return new Promise((resolve, reject) => {
      pending = {
        resolve, reject, matches, lines: [],
        timer: setTimeout(() => fail(new Error(`Engine response timed out: ${stderr}`)), 10000),
      };
      child.stdin.write(`${commands.join("\n")}\n`);
    });
  }
  const options = await sendUntil(["uci"], (line) => line === "uciok");
  assert.ok(options.includes(`option name UCI_Elo type spin default ${MIN_ENGINE_ELO} min ${MIN_ENGINE_ELO} max ${MAX_ENGINE_ELO}`));
  assert.ok(options.includes("option name UCI_LimitStrength type check default false"));
  for (const difficulty of [0, 42.5, 100]) {
    const ready = await sendUntil([...getDifficultyCommands(difficulty), "isready"], (line) => line === "readyok");
    assert.ok(!ready.some((line) => /unknown|no such|invalid|error/i.test(line)), ready.join("\n"));
    const result = await sendUntil(["ucinewgame", "position startpos", `go movetime ${ENGINE_MOVE_TIME}`],
      (line) => line.startsWith("bestmove "));
    const bestMove = result.at(-1).match(/^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
    assert.ok(bestMove, result.at(-1));
    assert.ok(new Chess().move({ from: bestMove[1], to: bestMove[2], promotion: bestMove[3] }));
  }
});
