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

test("every dialogue has complete stored pinyin, with erhua counted as one syllable", () => {
  for (const dialogue of DIALOGUES) {
    const text = dialogue.zhHans.replaceAll("〇〇", "");
    const reading = dialogue.pinyin.replaceAll("〇〇", "");
    assert.ok(reading.trim(), dialogue.id);
    assert.doesNotMatch(reading, /\p{Script=Han}|\d| {2}/u, dialogue.id);
    const characters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
    const erhua = text.match(/(?:哪|这|那|点)儿/gu)?.length ?? 0;
    const syllables = reading.match(/\p{Script=Latin}+/gu)?.length ?? 0;
    assert.equal(syllables, characters - erhua, dialogue.zhHans);
  }
});

test("stored pinyin distinguishes contextual readings, neutral tones and erhua", () => {
  for (const [text, expected] of [
    ["你起得真早！", "Nǐ qǐ de zhēn zǎo!"],
    ["谁教你的？", "Shuí jiāo nǐ de?"],
    ["谁干的？", "Shuí gàn de?"],
    ["只剩你一个了。", "Zhǐ shèng nǐ yí gè le."],
    ["王侯将相，宁有种乎！", "Wáng hóu jiàng xiàng, nìng yǒu zhǒng hū!"],
    ["我在收拾桌上的东西。", "Wǒ zài shōu shi zhuō shàng de dōng xi."],
    ["我的朋友去哪儿了？", "Wǒ de péng you qù nǎr le?"],
    ["我有点儿紧张。", "Wǒ yǒu diǎnr jǐn zhāng."],
  ]) {
    assert.equal(DIALOGUES.find((dialogue) => dialogue.zhHans === text)?.pinyin, expected, text);
  }
});

test("the original 90 lines retain their text, order and trigger codes", async () => {
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
  const original = DIALOGUES.filter((d) => d.id.startsWith("translated-"));
  assert.equal(original.length, 90);
  assert.deepEqual(original.map((d) => [d.triggerCode, d.zhHans]), expected);
});

test("all 182 additional lines preserve the source text, translation and trigger, with unique IDs and learning notes", async () => {
  const markdown = await readFile(new URL("../drafts/chinese_chess_new_dialogues_182_2026-10-29.md", import.meta.url), "utf8");
  const body = markdown.split("# 新規追加セリフ（文法事項別）")[1];
  const expected = [...body.matchAll(/^\| (\d+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(([, code, zh, ja]) => [code, zh.trim(), ja.trim()]);
  const additional = DIALOGUES.filter((d) => d.id.startsWith("additional-"));
  assert.equal(additional.length, 182);
  assert.deepEqual(additional.map((d) => [d.triggerCode, d.zhHans, d.ja]), expected);
  assert.equal(DIALOGUES.length, 272);
  assert.equal(new Set(DIALOGUES.map((d) => d.triggerCode)).size, 33);
  assert.equal(new Set(DIALOGUES.map((d) => d.id)).size, 272);
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
  assert.ok(getDialogueCandidates("20", context).some((d) => d.zhHans === "她回来了！"));
  for (const [piece, name, reading] of [["q", "王后", "Wáng hòu"], ["r", "车", "Chē"], ["b", "象", "Xiàng"], ["n", "马", "Mǎ"]]) {
    const move = new Chess(noQueen).move({ from: "a7", to: "a8", promotion: piece });
    const candidates = getDialogueCandidates("20", getMoveDialogueContext(move, "w"));
    assert.equal(candidates[0].zhHans, `${name}出现了！`);
    assert.equal(candidates[0].pinyin, `${reading} chū xiàn le!`);
    assert.ok(candidates.every((d) => !JSON.stringify(d).includes("〇〇")));
    assert.equal(candidates.some((d) => d.zhHans === "她回来了！"), piece === "q");
    assert.equal(candidates.some((d) => d.id === "translated-20-2"), piece === "q");
    assert.ok(candidates.every((d) => d.zhHans !== "她也是王后！"));
  }
  const existingQueen = new Chess("7k/P6p/8/8/8/8/6P1/3Q3K w - - 0 1").move("a8=Q+");
  const existingQueenLines = getDialogueCandidates("20", getMoveDialogueContext(existingQueen, "w"));
  assert.ok(existingQueenLines.some((d) => d.zhHans === "她也是王后！"));
  assert.ok(existingQueenLines.every((d) => !["她回来了！", "王后回来了！"].includes(d.zhHans)));
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

test("AI and player forks and pins have distinct triggers and only fire when newly created", () => {
  const fork = "7k/8/8/1r3r2/8/8/2N3PP/7K w - - 0 1";
  assert.equal(trigger(fork, "Nd4", "npc"), "31");
  assert.equal(trigger(fork, "Nd4"), "32");
  const pin = "4k3/4n2p/8/8/8/8/6P1/R6K w - - 0 1";
  assert.equal(trigger(pin, "Re1", "npc"), "31");
  assert.equal(trigger(pin, "Re1"), "32");
  const game = new Chess(pin);
  game.move("Re1"); game.move("h6");
  assert.equal(getMoveTriggerCode(game.move("Re2"), "npc", null, freshHistory()), null);
  const playerGame = new Chess(pin);
  playerGame.move("Re1"); playerGame.move("h6");
  assert.equal(getMoveTriggerCode(playerGame.move("Re2"), "player", null, freshHistory()), null);
  for (const [fen, san] of [
    ["7k/2n3pp/8/8/1R3R2/8/8/7K b - - 0 1", "Nd5"],
    ["r6k/6p1/8/8/8/8/4N2P/4K3 b - - 0 1", "Re8"],
    ["8/3R4/8/4k3/8/8/6PK/4r3 w - - 0 1", "Re7+"],
  ]) {
    assert.equal(trigger(fen, san, "npc"), "31");
    assert.equal(trigger(fen, san, "player"), "32");
  }
});

function directionalLines(fen, san, playerColor) {
  const move = new Chess(fen).move(san);
  const actor = move.color === playerColor ? "player" : "npc";
  const context = getMoveDialogueContext(move, playerColor);
  const code = getMoveTriggerCode(move, actor, null, freshHistory());
  return { context, code, lines: getDialogueCandidates(code, context)
    .filter((d) => d.triggerCode === "33").map((d) => d.zhHans) };
}

test("directional checks use the checked king's forward direction and fixed board coordinates for either actor", () => {
  for (const playerColor of ["w", "b"]) {
    for (const [fen, san, directions, expected, excluded] of [
      ["4k3/p7/8/8/8/8/6P1/R6K w - - 0 1", "Re1+", ["down", "front"],
        ["前面有敌人！", "看前面！"], ["敌人在后面！", "危险在上面！", "下面也有敌人！"]],
      ["r6k/6p1/8/8/8/8/P7/4K3 b - - 0 1", "Re8+", ["up", "front"],
        ["前面有敌人！", "看前面！", "危险在上面！"], ["看后面！", "下面也有敌人！"]],
      ["8/6kp/8/8/8/8/6P1/R6K w - - 0 1", "Ra7+", ["left"],
        ["看左边！"], ["看右边！", "看前面！", "看后面！", "他在我旁边！"]],
      ["8/pk6/8/8/8/8/7P/6RK w - - 0 1", "Rg7+", ["right"],
        ["看右边！"], ["看左边！", "看前面！", "看后面！"]],
      ["8/6kp/8/8/8/8/6P1/R6K w - - 0 1", "Ra8", [], [],
        ["前面有敌人！", "看左边！"]],
    ]) {
      const move = new Chess(fen).move(san);
      const context = getMoveDialogueContext(move, playerColor);
      const code = move.color === playerColor ? "16" : "15";
      const candidates = getDialogueCandidates(code, context);
      const lines = candidates.filter((d) => d.triggerCode === "33").map((d) => d.zhHans);
      assert.deepEqual(context.check?.directions ?? [], directions);
      assert.ok(expected.every((line) => lines.includes(line)));
      assert.ok(excluded.every((line) => !lines.includes(line)));
      assert.ok(candidates.some((d) => d.triggerCode === code));
      assert.ok(getDialogueCandidates(code === "15" ? "16" : "15", context)
        .every((d) => d.triggerCode !== "33"));
      assert.ok(getDialogueCandidates("1", context).every((d) => d.triggerCode !== "33"));
    }
  }
  assert.deepEqual(getDialogueCandidates("33", { playerColor: "w" }), []);
});

test("rear checks, discovered checks and diagonal checks follow actual attackers", () => {
  const rear = directionalLines("8/3R4/8/4k3/p7/8/6P1/7K w - - 0 1", "Rd8", "w");
  assert.equal(rear.code, null); // No check, despite an enemy piece behind the king.
  const back = directionalLines("8/3R4/8/4k3/p7/8/6P1/7K w - - 0 1", "Re7+", "w");
  assert.ok(back.lines.includes("敌人在后面！"));
  assert.ok(!back.lines.includes("看前面！"));
  const discovered = directionalLines("4k3/p7/8/8/8/8/4B1P1/4R2K w - - 0 1", "Bf3+", "w");
  assert.ok(discovered.lines.includes("看前面！"));
  assert.ok(!discovered.lines.includes("看右边！")); // The bishop is not the checker.
  const diagonal = directionalLines("4k3/p7/8/8/8/8/6P1/5B1K w - - 0 1", "Bb5+", "w");
  assert.ok(diagonal.lines.includes("看左边！"));
  assert.ok(diagonal.lines.includes("看前面！"));
});

test("adjacent attackers refer only to the NPC king; 'also below' needs a second checking direction", () => {
  const fen = "8/8/4k3/8/4B3/8/6P1/4R2K w - - 0 1";
  const double = directionalLines(fen, "Bd5+", "w");
  assert.equal(double.code, "16");
  assert.ok(double.lines.includes("他在我旁边！"));
  assert.ok(!double.lines.includes("下面也有敌人！")); // Both attackers are below.
  const npc = directionalLines(fen, "Bd5+", "b");
  assert.ok(!npc.lines.includes("他在我旁边！"));
  const bothSides = directionalLines("8/p7/8/4k3/3N4/8/1B4P1/7K w - - 0 1", "Nc6+", "w");
  assert.ok(bothSides.lines.includes("下面也有敌人！"));
  assert.ok(bothSides.lines.includes("危险在上面！"));
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
