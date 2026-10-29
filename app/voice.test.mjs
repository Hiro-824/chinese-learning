import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { DIALOGUES, getDialogueCandidates } from "./dialogues.ts";
import { DEFAULT_VOICE_VARIANT, getDialogueAudioSrc, parseVoiceVariant, VOICE_OPTIONS } from "./voice.ts";

test("all available voices cover every dialogue with matching text and audio files", async () => {
  const allPaths = new Set();
  for (const variant of Object.keys(VOICE_OPTIONS)) {
    for (const gender of ["female", "male"]) {
      if (variant === "3" && gender === "male") continue;
      const index = JSON.parse(await readFile(new URL(`../public/voice/${variant}/${gender}/lines-index.json`, import.meta.url), "utf8"));
      assert.deepEqual(index.map((line) => line.id).sort(), DIALOGUES.map((line) => line.id).sort());
      for (const dialogue of DIALOGUES) {
        const recording = index.find((line) => line.id === dialogue.id);
        assert.equal(recording.zhHans, dialogue.zhHans, `${variant}/${gender}: ${dialogue.id}`);
        const src = getDialogueAudioSrc(gender, dialogue.id, variant);
        assert.equal(src, `/voice/${variant}/${gender}/${recording.audio}`);
        if (allPaths.has(src)) continue;
        allPaths.add(src);
        const file = await readFile(new URL(`../public${src}`, import.meta.url));
        assert.ok(file.length > 1000, src);
        if (src.endsWith(".mp3")) {
          assert.equal(file.toString("ascii", 0, 3), "ID3", src);
        } else {
          assert.equal(file.toString("ascii", 4, 8), "ftyp", src);
        }
      }
    }
  }
  assert.equal(allPaths.size, 1320);
});

test("voice selection defaults to voice 1 and saved variants are validated", () => {
  assert.equal(DEFAULT_VOICE_VARIANT, "1");
  for (const variant of ["1", "2", "3"]) assert.equal(parseVoiceVariant(variant), variant);
  for (const invalid of [null, undefined, "", "4", "constructor", "__proto__", 1, 2, 3]) {
    assert.equal(parseVoiceVariant(invalid), "1");
  }
  for (const gender of ["female", "male"]) {
    assert.equal(getDialogueAudioSrc(gender, DIALOGUES[0].id), getDialogueAudioSrc(gender, DIALOGUES[0].id, "1"));
  }
});

test("each gender and variant has its own recording; promotion keeps its recorded dialogue ID", () => {
  for (const dialogue of DIALOGUES) {
    const paths = Object.keys(VOICE_OPTIONS).flatMap((variant) => ["female", "male"].map((gender) => getDialogueAudioSrc(gender, dialogue.id, variant)));
    assert.equal(new Set(paths).size, 5);
  }
  for (const variant of Object.keys(VOICE_OPTIONS)) {
    for (const gender of ["female", "male"]) {
      for (const promotion of ["q", "r", "b", "n"]) {
        const [dialogue] = getDialogueCandidates("20", { playerColor: "w", promotion });
        assert.ok(!dialogue.zhHans.includes("〇〇"));
        assert.ok(getDialogueAudioSrc(gender, dialogue.id, variant));
      }
      for (const id of ["missing", "constructor", "__proto__"]) {
        assert.equal(getDialogueAudioSrc(gender, id, variant), null);
      }
    }
  }
});

test("voice 3 is female-only; male/random male characters use voice 1 without changing the saved variant", () => {
  for (const dialogue of DIALOGUES) {
    assert.ok(getDialogueAudioSrc("female", dialogue.id, "3").startsWith("/voice/3/female/"));
    assert.equal(getDialogueAudioSrc("male", dialogue.id, "3"), getDialogueAudioSrc("male", dialogue.id, "1"));
  }
});

test("Ondoku files are copied byte-for-byte, and numbered source files match the supplied text index", async () => {
  const index = JSON.parse(await readFile(new URL("../public/voice/3/female/lines-index.json", import.meta.url), "utf8"));
  const tsv = await readFile(new URL("../downloads/ondoku_chinese_chess_ssml_1500ms/index.tsv", import.meta.url), "utf8");
  const sources = new Map(tsv.trim().split(/\r?\n/).slice(1).map((row) => {
    const [, text, , set, number] = row.split("\t");
    return [text, `downloads/ondokusan/set-${Number(set.match(/\d+/)[0])}-divided/${Number(number) - 1}.mp3`];
  }));
  const uniqueFiles = new Set();
  for (const recording of index) {
    assert.equal(recording.source, sources.get(recording.zhHans));
    const original = await readFile(new URL(`../${recording.source}`, import.meta.url));
    const copy = await readFile(new URL(`../public/voice/3/female/${recording.audio}`, import.meta.url));
    assert.deepEqual(copy, original, recording.id);
    const sha = createHash("sha256").update(copy).digest("hex");
    assert.equal(recording.sha256, sha);
    assert.equal(recording.audio, `audio/${sha.slice(0, 16)}.mp3`);
    uniqueFiles.add(recording.source);
  }
  assert.equal(uniqueFiles.size, 264);
});
