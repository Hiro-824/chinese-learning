import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Chess } from "chess.js";
import {
  DIALOGUES, getDialogueCandidates, getMaterialReversalTrigger,
  getMoveDialogueContext, getMoveTriggerCode, getOpeningTriggerCode, selectUnusedDialogue,
} from "./dialogues.ts";

const freshHistory = () => ({ npcWasBehind: false, playerWasBehind: false });
function trigger(fen, san, actor = "player", history = freshHistory()) {
  return getMoveTriggerCode(new Chess(fen).move(san), actor, null, history);
}

test("the complete runtime corpus matches lines-translated, including escaped list numbers", async () => {
  const markdown = await readFile(new URL("../drafts/lines-translated.md", import.meta.url), "utf8");
  const expected = [];
  let code;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^### (\d+)\./);
    if (heading) code = heading[1];
    else if (line.startsWith("## ")) code = undefined;
    const match = line.match(/^\d+\\?\.\s+(.+?)(?:〔.+〕)?$/);
    if (code && match) expected.push([code, match[1].trim()]);
  }
  assert.equal(DIALOGUES.length, 90);
  assert.deepEqual(DIALOGUES.map((d) => [d.triggerCode, d.zhHans]), expected);
  assert.equal(new Set(DIALOGUES.map((d) => d.triggerCode)).size, 31);
  assert.equal(new Set(DIALOGUES.map((d) => d.id)).size, 90);
  for (const dialogue of DIALOGUES) {
    assert.ok(dialogue.ja && dialogue.learning.length);
    for (const item of dialogue.learning) assert.ok(item.phrase && item.role && item.meaning);
  }
});

test("all ten capture conditions distinguish piece type and actor", () => {
  for (const [piece, npc, player] of [["p", "1", "2"], ["n", "3", "4"],
    ["b", "5", "6"], ["r", "7", "8"], ["q", "9", "10"]]) {
    const fen = `7k/6p1/8/8/1${piece}6/P7/8/3Q3K w - - 0 1`;
    assert.equal(trigger(fen, "axb4", "npc"), npc);
    assert.equal(trigger(fen, "axb4"), player);
  }
});

test("an immediate equal-value recapture announces an exchange", () => {
  const game = new Chess();
  game.move("e4"); game.move("d5");
  const capture = game.move("exd5");
  assert.equal(getMoveTriggerCode(game.move("Qxd5"), "npc", {
    to: capture.to, actor: "player", captured: capture.captured,
  }, freshHistory()), "11");
});

test("checks and checkmates select the correct side, with mate taking priority", () => {
  const fen = "4k3/p7/8/8/8/8/6P1/R6K w - - 0 1";
  assert.equal(trigger(fen, "Re1+", "npc"), "15");
  assert.equal(trigger(fen, "Re1+"), "16");
  for (const [actor, code] of [["npc", "18"], ["player", "17"]]) {
    const game = new Chess();
    game.move("f3"); game.move("e5"); game.move("g4");
    assert.equal(getMoveTriggerCode(game.move("Qh4#"), actor, null, freshHistory()), code);
  }
});

test("rebellion is a response to the NPC king being checked, with either player color", () => {
  for (const [fen, san, moverColor] of [
    ["4k3/p7/8/8/8/8/6P1/R6K w - - 0 1", "Re1+", "w"],
    ["r6k/6p1/8/8/8/8/P7/4K3 b - - 0 1", "Re8+", "b"],
  ]) {
    const playerCheck = getDialogueCandidates(trigger(fen, san, "player"), { playerColor: moverColor });
    assert.ok(playerCheck.some((line) => line.zhHans === "这是叛乱！"));
    const npcCheck = getDialogueCandidates(trigger(fen, san, "npc"), {
      playerColor: moverColor === "w" ? "b" : "w",
    });
    assert.ok(npcCheck.every((line) => line.zhHans !== "这是叛乱！"));
  }
});

test("promotion names and queen-return lines follow the actual promoted piece and board", () => {
  const noQueen = "7k/P6p/8/8/8/8/6P1/7K w - - 0 1";
  assert.equal(trigger(noQueen, "a8=Q+", "npc"), "19");
  assert.equal(trigger(noQueen, "a8=Q+"), "20");
  const context = getMoveDialogueContext(new Chess(noQueen).move("a8=Q+"), "w");
  assert.equal(context.queenReturned, true);
  assert.equal(getDialogueCandidates("20", context).length, 2);
  for (const [piece, name] of [["q", "王后"], ["r", "车"], ["b", "象"], ["n", "马"]]) {
    const move = new Chess(noQueen).move({ from: "a7", to: "a8", promotion: piece });
    const candidates = getDialogueCandidates("20", getMoveDialogueContext(move, "w"));
    assert.equal(candidates[0].zhHans, `${name}出现了！`);
    assert.ok(candidates.every((d) => !JSON.stringify(d).includes("〇〇")));
    assert.equal(candidates.length, piece === "q" ? 2 : 1);
  }
  const existingQueen = new Chess("7k/P6p/8/8/8/8/6P1/3Q3K w - - 0 1").move("a8=Q+");
  assert.equal(getDialogueCandidates("20", getMoveDialogueContext(existingQueen, "w")).length, 1);
  assert.equal(getMoveDialogueContext(new Chess(noQueen).move("a8=Q+"), "b").queenReturned, false);
});

test("lone-king announcements occur on the transition, not on every later move", () => {
  const fen = "7k/8/8/8/1n6/P7/8/3Q3K w - - 0 1";
  assert.equal(trigger(fen, "axb4"), "21");
  assert.equal(trigger(fen, "axb4", "npc"), "22");
  const game = new Chess(fen);
  game.move("axb4");
  assert.equal(getMoveTriggerCode(game.move("Kh7"), "npc", null, freshHistory()), null);
});

test("castling distinguishes both sides and both wings", () => {
  for (const san of ["O-O", "O-O-O"]) {
    const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
    assert.equal(trigger(fen, san, "npc"), "25");
    assert.equal(trigger(fen, san), "26");
  }
});

test("player rook movement needs at least four squares", () => {
  const fen = "7k/7p/8/8/8/8/6P1/R6K w - - 0 1";
  assert.equal(trigger(fen, "Ra5"), "28");
  assert.equal(trigger(fen, "Ra4"), null);
  assert.equal(trigger(fen, "Ra5", "npc"), null);
});

test("AI forks and pins trigger only when newly created", () => {
  const fork = "7k/8/8/1r3r2/8/8/2N3PP/7K w - - 0 1";
  assert.equal(trigger(fork, "Nd4", "npc"), "31");
  assert.equal(trigger(fork, "Nd4"), null);
  const pin = "4k3/4n2p/8/8/8/8/6P1/R6K w - - 0 1";
  assert.equal(trigger(pin, "Re1", "npc"), "31");
  const game = new Chess(pin);
  game.move("Re1"); game.move("h6");
  assert.equal(getMoveTriggerCode(game.move("Re2"), "npc", null, freshHistory()), null);
});

test("openings use first-color, repeat, time, then regular greetings", () => {
  const base = { playerColor: "w", firstWithColor: false, gamesToday: 1, hour: 14 };
  assert.equal(getOpeningTriggerCode({ ...base, firstWithColor: true }), "12");
  assert.equal(getOpeningTriggerCode({ ...base, firstWithColor: true, playerColor: "b" }), "13");
  assert.equal(getOpeningTriggerCode({ ...base, gamesToday: 2, hour: 6 }), "27");
  for (const hour of [5, 11]) assert.equal(getOpeningTriggerCode({ ...base, hour }), "23");
  for (const hour of [0, 4, 18, 23]) assert.equal(getOpeningTriggerCode({ ...base, hour }), "24");
  for (const hour of [12, 17]) assert.equal(getOpeningTriggerCode({ ...base, hour }), "14");
  for (const [color, allowed, excluded] of [["w", ["你是白方。", "我是黑方。"], ["你是黑方。", "我是白方。"]],
    ["b", ["你是黑方。", "我是白方。"], ["你是白方。", "我是黑方。"]]]) {
    const lines = getDialogueCandidates("14", { playerColor: color }).map((d) => d.zhHans);
    assert.ok(allowed.every((line) => lines.includes(line)));
    assert.ok(excluded.every((line) => !lines.includes(line)));
  }
});

test("reversals remember a 3-point deficit across neutral positions and fire at a 3-point lead", () => {
  for (const [sign, code] of [[1, "29"], [-1, "30"]]) {
    const history = freshHistory();
    const sequence = [0, -3, -1, 0, 1, 2, 3, 4, 2, 3];
    const result = sequence.slice(1).map((value, index) =>
      getMaterialReversalTrigger(sequence[index] * sign, value * sign, history));
    assert.deepEqual(result, [null, null, null, null, null, code, null, null, null]);
  }
});

test("small sign changes do not qualify; a new 3-point deficit rearms a reversal", () => {
  const history = freshHistory();
  assert.equal(getMaterialReversalTrigger(-2, 3, history), null);
  assert.equal(getMaterialReversalTrigger(3, -3, history), "30");
  assert.equal(getMaterialReversalTrigger(-3, 3, history), "29");
  assert.equal(getMaterialReversalTrigger(3, -4, history), "30");
  assert.equal(getMaterialReversalTrigger(-4, 4, history), "29");
  assert.equal(getMaterialReversalTrigger(0, 3, freshHistory()), null);
});

test("move integration records disadvantage on quiet moves and respects NPC color", () => {
  for (const [actor, expected] of [["npc", "29"], ["player", "30"]]) {
    const history = freshHistory();
    const fen = "7k/6pp/8/8/1q6/P7/8/3Q3K w - - 0 1";
    // White is only one point behind; an earlier 3-point disadvantage is required.
    history[actor === "npc" ? "npcWasBehind" : "playerWasBehind"] = true;
    assert.equal(trigger(fen, "axb4", actor, history), expected);
  }
  const history = freshHistory();
  assert.equal(trigger("7k/6pp/8/8/1q6/P7/8/7K w - - 0 1", "Kh2", "npc", history), null);
  assert.equal(history.npcWasBehind, true);
});

test("selection cycles through eligible lines before repeating", () => {
  const candidates = getDialogueCandidates("1", { playerColor: "w" });
  const used = new Set();
  const chosen = candidates.map(() => selectUnusedDialogue(candidates, used, () => 0).id);
  assert.equal(new Set(chosen).size, candidates.length);
  assert.equal(selectUnusedDialogue(candidates, used, () => 0).id, chosen[0]);
  assert.equal(selectUnusedDialogue([], used), null);
});
