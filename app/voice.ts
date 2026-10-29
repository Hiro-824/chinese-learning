import femaleAudioMap from "../public/voice/female/audio-map.json" with { type: "json" };
import maleAudioMap from "../public/voice/male/audio-map.json" with { type: "json" };
import type { CharacterGender } from "./character";

const AUDIO_MAPS: Record<CharacterGender, Record<string, string>> = {
  female: femaleAudioMap,
  male: maleAudioMap,
};

export function getDialogueAudioSrc(gender: CharacterGender, dialogueId: string) {
  const map = AUDIO_MAPS[gender];
  return Object.hasOwn(map, dialogueId)
    ? `/voice/${gender}/${map[dialogueId]}`
    : null;
}
