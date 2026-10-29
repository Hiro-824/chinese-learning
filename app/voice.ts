import femaleAudioMap1 from "../public/voice/1/female/audio-map.json" with { type: "json" };
import maleAudioMap1 from "../public/voice/1/male/audio-map.json" with { type: "json" };
import femaleAudioMap2 from "../public/voice/2/female/audio-map.json" with { type: "json" };
import maleAudioMap2 from "../public/voice/2/male/audio-map.json" with { type: "json" };
import type { CharacterGender } from "./character";

export const VOICE_OPTIONS = { "1": "声1", "2": "声2" } as const;
export type VoiceVariant = keyof typeof VOICE_OPTIONS;
export const DEFAULT_VOICE_VARIANT: VoiceVariant = "1";

const AUDIO_MAPS: Record<VoiceVariant, Record<CharacterGender, Record<string, string>>> = {
  "1": { female: femaleAudioMap1, male: maleAudioMap1 },
  "2": { female: femaleAudioMap2, male: maleAudioMap2 },
};

export function parseVoiceVariant(value: unknown): VoiceVariant {
  return value === "1" || value === "2" ? value : DEFAULT_VOICE_VARIANT;
}

export function getDialogueAudioSrc(
  gender: CharacterGender,
  dialogueId: string,
  variant: VoiceVariant = DEFAULT_VOICE_VARIANT,
) {
  const map = AUDIO_MAPS[variant][gender];
  return Object.hasOwn(map, dialogueId)
    ? `/voice/${variant}/${gender}/${map[dialogueId]}`
    : null;
}
