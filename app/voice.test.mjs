import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIALOGUES, getDialogueCandidates } from "./dialogues.ts";
import { getDialogueAudioSrc } from "./voice.ts";

test("both voices cover every current dialogue with matching text and valid M4A files", async () => {
  const allPaths = new Set();
  for (const gender of ["female", "male"]) {
    const index = JSON.parse(await readFile(new URL(`../public/voice/${gender}/lines-index.json`, import.meta.url), "utf8"));
    assert.deepEqual(index.map((line) => line.id).sort(), DIALOGUES.map((line) => line.id).sort());
    for (const dialogue of DIALOGUES) {
      const recording = index.find((line) => line.id === dialogue.id);
      assert.equal(recording.zhHans, dialogue.zhHans, `${gender}: ${dialogue.id}`);
      const src = getDialogueAudioSrc(gender, dialogue.id);
      assert.equal(src, `/voice/${gender}/${recording.audio}`);
      if (allPaths.has(src)) continue;
      allPaths.add(src);
      const file = await readFile(new URL(`../public${src}`, import.meta.url));
      assert.ok(file.length > 1000, src);
      assert.equal(file.toString("ascii", 4, 8), "ftyp", src);
    }
  }
  assert.equal(allPaths.size, 528);
});

test("voice follows the selected character and promotion retains its recorded dialogue ID", () => {
  for (const dialogue of DIALOGUES) {
    assert.notEqual(getDialogueAudioSrc("female", dialogue.id), getDialogueAudioSrc("male", dialogue.id));
  }
  for (const promotion of ["q", "r", "b", "n"]) {
    const [dialogue] = getDialogueCandidates("20", { playerColor: "w", promotion });
    assert.ok(!dialogue.zhHans.includes("〇〇"));
    assert.ok(getDialogueAudioSrc("female", dialogue.id));
    assert.ok(getDialogueAudioSrc("male", dialogue.id));
  }
  for (const id of ["missing", "constructor", "__proto__"]) {
    assert.equal(getDialogueAudioSrc("female", id), null);
  }
});
