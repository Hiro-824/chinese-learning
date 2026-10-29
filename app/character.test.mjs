import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHARACTER_EXPRESSIONS, CHARACTER_PORTRAITS, DIALOGUE_EXPRESSIONS,
  getCharacterExpression, getCharacterPortrait, parseCharacterPreference, resolveCharacterGender,
} from "./character.ts";
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

test("female expression portraits and the male base portrait reference existing WebP assets", async () => {
  assert.equal(Object.keys(CHARACTER_EXPRESSIONS).length, 10);
  assert.equal(new Set(Object.values(CHARACTER_EXPRESSIONS).map((p) => p.src)).size, 10);
  for (const portrait of Object.values(CHARACTER_EXPRESSIONS)) {
    assert.ok(portrait.label);
    assert.ok(portrait.src.startsWith("/character/female/"));
  }
  const paths = Object.values(CHARACTER_PORTRAITS).flatMap((portraits) => Object.values(portraits).map((p) => p.src));
  for (const path of paths) {
    const data = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
  }
});

test("character preferences survive parsing and random selection chooses either gender", () => {
  for (const value of [null, undefined, "", "invalid", "constructor", 0]) {
    assert.equal(parseCharacterPreference(value), "female");
  }
  for (const value of ["female", "male", "random"]) assert.equal(parseCharacterPreference(value), value);
  const mustNotRandomize = () => { throw new Error("Fixed choices must not be randomized"); };
  assert.equal(resolveCharacterGender("female", mustNotRandomize), "female");
  assert.equal(resolveCharacterGender("male", mustNotRandomize), "male");
  for (const value of [0, 0.49]) assert.equal(resolveCharacterGender("random", () => value), "female");
  for (const value of [0.5, 0.99]) assert.equal(resolveCharacterGender("random", () => value), "male");
});

test("missing male expressions use the male base portrait, while female expressions remain distinct", () => {
  for (const expression of Object.keys(CHARACTER_EXPRESSIONS)) {
    const female = getCharacterPortrait("female", expression);
    assert.equal(female.src, `/character/female/${expression}.webp`);
    assert.equal(female.expression, expression);
    const male = getCharacterPortrait("male", expression);
    assert.equal(male.src, "/character/male/neutral.webp");
    assert.equal(male.expression, "neutral");
    assert.equal(male.label, CHARACTER_PORTRAITS.male.neutral.label);
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
