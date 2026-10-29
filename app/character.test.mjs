import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { CHARACTER_EXPRESSIONS, DIALOGUE_EXPRESSIONS, getCharacterExpression } from "./character.ts";
import { DIALOGUES, getDialogueCandidates } from "./dialogues.ts";

test("every dialogue has a deliberate expression, with no stale dialogue IDs", () => {
  assert.deepEqual(Object.keys(DIALOGUE_EXPRESSIONS).sort(), DIALOGUES.map((d) => d.id).sort());
  const used = new Set();
  for (const dialogue of DIALOGUES) {
    const expression = getCharacterExpression(dialogue);
    assert.ok(Object.hasOwn(CHARACTER_EXPRESSIONS, expression), dialogue.id);
    used.add(expression);
  }
  assert.deepEqual([...used].sort(), Object.keys(CHARACTER_EXPRESSIONS).sort());
});

test("the ten portraits reference existing WebP assets", async () => {
  const directory = new URL("../public/character/", import.meta.url);
  const files = await readdir(directory);
  assert.equal(Object.keys(CHARACTER_EXPRESSIONS).length, 10);
  assert.equal(new Set(Object.values(CHARACTER_EXPRESSIONS).map((p) => p.src)).size, 10);
  for (const portrait of Object.values(CHARACTER_EXPRESSIONS)) {
    const filename = portrait.src.split("/").at(-1);
    assert.ok(files.includes(filename), portrait.src);
    assert.ok(portrait.label);
    const data = await readFile(new URL(filename, directory));
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
  }
});

test("tone within the same chess event determines the expression", () => {
  for (const [text, expected] of [
    ["我快哭了。", "distressed"],
    ["你有一颗冰冷的心！", "angry"],
    ["我想回家了。", "sad"],
    ["赢了，开心吗？太好了！", "happy"],
    ["我讨厌输。", "angry"],
    ["明天我会赢！", "confident"],
    ["你非常聪明！", "happy"],
    ["你太快了！", "surprised"],
    ["我有点儿害怕。", "worried"],
    ["这是什么？", "curious"],
  ]) {
    const dialogue = DIALOGUES.find((d) => d.zhHans === text);
    assert.ok(dialogue, text);
    assert.equal(getCharacterExpression(dialogue), expected, text);
  }
  const farewell = (code) => getDialogueCandidates(code, { playerColor: "w" })
    .find((d) => d.zhHans === "再见了。");
  assert.equal(getCharacterExpression(farewell("3")), "smug");
  assert.equal(getCharacterExpression(farewell("6")), "sad");
});

test("promoted-piece substitution preserves the expression; idle and unknown lines use neutral", () => {
  for (const promotion of ["q", "r", "b", "n"]) {
    const dialogue = getDialogueCandidates("20", { playerColor: "w", promotion })[0];
    assert.ok(!dialogue.zhHans.includes("〇〇"));
    assert.equal(getCharacterExpression(dialogue), "surprised");
  }
  assert.equal(getCharacterExpression(), "neutral");
  assert.equal(getCharacterExpression(null), "neutral");
  assert.equal(getCharacterExpression({ id: "future-dialogue" }), "neutral");
});
