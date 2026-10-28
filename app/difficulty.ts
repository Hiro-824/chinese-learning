export const MIN_DIFFICULTY = 0;
export const MAX_DIFFICULTY = 100;
export const DIFFICULTY_STEP = 0.1;
export const DEFAULT_DIFFICULTY = 25;

// Supported range advertised by the bundled Stockfish 19 Lite WASM engine.
export const MIN_ENGINE_ELO = 1320;
export const MAX_ENGINE_ELO = 3190;
export const ENGINE_MOVE_TIME = 800;

const LEGACY_DIFFICULTIES: Record<string, number> = {
  beginner: 0,
  intermediate: 50,
  advanced: 90,
};

export function parseSavedDifficulty(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (Object.hasOwn(LEGACY_DIFFICULTIES, value)) return LEGACY_DIFFICULTIES[value];
  const difficulty = Number(value);
  if (!Number.isFinite(difficulty) || difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
    return null;
  }
  return Math.round(difficulty * 10) / 10;
}

export function difficultyToElo(difficulty: number) {
  const bounded = Number.isFinite(difficulty)
    ? Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, difficulty))
    : DEFAULT_DIFFICULTY;
  return Math.round(MIN_ENGINE_ELO + (MAX_ENGINE_ELO - MIN_ENGINE_ELO) * bounded / MAX_DIFFICULTY);
}

export function getDifficultyCommands(difficulty: number): string[] {
  return [
    "setoption name MultiPV value 1",
    "setoption name UCI_LimitStrength value true",
    `setoption name UCI_Elo value ${difficultyToElo(difficulty)}`,
  ];
}
