import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIALOGUES, getDialogueCandidates } from "./dialogues.ts";
import { DEFAULT_VOICE_VARIANT, getDialogueAudioSrc, parseVoiceVariant, VOICE_OPTIONS } from "./voice.ts";

test("both variants of both genders cover every dialogue with matching text and M4A files", async () => {
  const allPaths = new Set();
  for (const variant of Object.keys(VOICE_OPTIONS)) {
    for (const gender of ["female", "male"]) {
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
        assert.equal(file.toString("ascii", 4, 8), "ftyp", src);
      }
    }
  }
  assert.equal(allPaths.size, 1056);
});

test("voice selection defaults to voice 1 and saved variants are validated", () => {
  assert.equal(DEFAULT_VOICE_VARIANT, "1");
  for (const variant of ["1", "2"]) assert.equal(parseVoiceVariant(variant), variant);
  for (const invalid of [null, undefined, "", "3", "constructor", "__proto__", 1, 2]) {
    assert.equal(parseVoiceVariant(invalid), "1");
  }
  for (const gender of ["female", "male"]) {
    assert.equal(getDialogueAudioSrc(gender, DIALOGUES[0].id), getDialogueAudioSrc(gender, DIALOGUES[0].id, "1"));
  }
});

test("each gender and variant has its own recording; promotion keeps its recorded dialogue ID", () => {
  for (const dialogue of DIALOGUES) {
    const paths = Object.keys(VOICE_OPTIONS).flatMap((variant) => ["female", "male"].map((gender) => getDialogueAudioSrc(gender, dialogue.id, variant)));
    assert.equal(new Set(paths).size, 4);
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
