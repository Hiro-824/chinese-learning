import type { PieceSymbol, Square } from "chess.js";

export type DialogueActor = "npc" | "player";
export type DialogueSetNumber = 1 | 2 | 3 | 4;

export type LearningItem = {
  phrase: string;
  role: string;
  meaning: string;
};

export type Dialogue = {
  id: string;
  zhHans: string;
  ja: string;
  triggerCode: string;
  learning: LearningItem[];
  source: "set";
  setId?: DialogueSetNumber;
};

export type DialogueTiming =
  | "game-start"
  | "after-player-move-before-npc"
  | "after-npc-move"
  | "after-triggering-recapture";

export type PreviousCapture = {
  to: Square;
  actor: DialogueActor;
  captured: PieceSymbol;
};

type MoveEvent = {
  actor: DialogueActor;
  captured?: PieceSymbol;
  to: Square;
  isCheck: boolean;
  isCheckmate: boolean;
};

type RawDialogueSet = {
  expressions?: Array<{
    dialogues?: Array<{
      id?: unknown;
      text?: { zhHans?: unknown; ja?: unknown };
      trigger?: { code?: unknown };
    }>;
  }>;
};

type RawAnnotationSet = {
  annotations?: Record<
    string,
    Array<{ phrase?: unknown; role?: unknown; meaning?: unknown }>
  >;
};

const CAPTURE_TRIGGER: Record<
  Exclude<PieceSymbol, "k">,
  Record<DialogueActor, string>
> = {
  p: { npc: "1.1", player: "1.2" },
  n: { npc: "1.3", player: "1.4" },
  b: { npc: "1.5", player: "1.6" },
  r: { npc: "1.7", player: "1.8" },
  q: { npc: "1.9", player: "1.10" },
};

const EXCHANGE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export const TRIGGER_TIMING: Record<string, DialogueTiming> = {
  "1.1": "after-npc-move",
  "1.2": "after-player-move-before-npc",
  "1.3": "after-npc-move",
  "1.4": "after-player-move-before-npc",
  "1.5": "after-npc-move",
  "1.6": "after-player-move-before-npc",
  "1.7": "after-npc-move",
  "1.8": "after-player-move-before-npc",
  "1.9": "after-npc-move",
  "1.10": "after-player-move-before-npc",
  "1.11": "after-triggering-recapture",
  "2.1": "game-start",
  "2.2": "game-start",
  "2.3": "game-start",
  "3.1": "after-npc-move",
  "3.2": "after-player-move-before-npc",
  "4.1": "after-player-move-before-npc",
  "4.2": "after-npc-move",
};

export function shouldAnnounceTrigger(
  triggerCode: string,
  actor: DialogueActor,
) {
  const timing = TRIGGER_TIMING[triggerCode];
  return (
    timing === "after-triggering-recapture" ||
    (actor === "player" && timing === "after-player-move-before-npc") ||
    (actor === "npc" && timing === "after-npc-move")
  );
}

export function getMoveTriggerCode(
  event: MoveEvent,
  previousCapture: PreviousCapture | null,
) {
  if (event.isCheckmate) return event.actor === "player" ? "4.1" : "4.2";
  if (event.isCheck) return event.actor === "npc" ? "3.1" : "3.2";
  if (
    event.captured &&
    previousCapture &&
    previousCapture.actor !== event.actor &&
    previousCapture.to === event.to &&
    EXCHANGE_VALUE[previousCapture.captured] === EXCHANGE_VALUE[event.captured]
  ) {
    return "1.11";
  }
  if (event.captured && event.captured !== "k") {
    return CAPTURE_TRIGGER[event.captured][event.actor];
  }
  return null;
}

export async function loadDialogueSet(
  setId: DialogueSetNumber,
): Promise<Dialogue[]> {
  const setNumber = String(setId).padStart(2, "0");
  const [dialogueResponse, annotationResponse] = await Promise.all([
    fetch(`/data/line/chess_set_${setNumber}.json`),
    fetch(`/data/line/chess_set_${setNumber}_annotations.json`),
  ]);
  if (!dialogueResponse.ok || !annotationResponse.ok) {
    throw new Error(`Dialogue set ${setId} could not be loaded`);
  }

  const data = (await dialogueResponse.json()) as RawDialogueSet;
  const annotationData = (await annotationResponse.json()) as RawAnnotationSet;
  const dialogues: Dialogue[] = [];
  for (const expression of data.expressions ?? []) {
    for (const item of expression.dialogues ?? []) {
      if (
        typeof item.id === "string" &&
        typeof item.text?.zhHans === "string" &&
        typeof item.text.ja === "string" &&
        typeof item.trigger?.code === "string"
      ) {
        const rawLearning = annotationData.annotations?.[item.id];
        if (
          !rawLearning?.length ||
          rawLearning.some(
            (learningItem) =>
              typeof learningItem.phrase !== "string" ||
              typeof learningItem.role !== "string" ||
              typeof learningItem.meaning !== "string",
          )
        ) {
          throw new Error(`Dialogue ${item.id} has no complete annotation`);
        }
        dialogues.push({
          id: item.id,
          zhHans: item.text.zhHans,
          ja: item.text.ja,
          triggerCode: item.trigger.code,
          learning: rawLearning as LearningItem[],
          source: "set",
          setId,
        });
      }
    }
  }
  return dialogues;
}

export function dialogueSelectionKey(dialogue: Dialogue) {
  return `${dialogue.source}:${dialogue.setId ?? "shared"}:${dialogue.id}`;
}

export function selectUnusedDialogue(
  candidates: Dialogue[],
  used: Set<string>,
  random = Math.random,
) {
  if (!candidates.length) return null;
  let available = candidates.filter(
    (dialogue) => !used.has(dialogueSelectionKey(dialogue)),
  );
  if (!available.length) {
    for (const dialogue of candidates) used.delete(dialogueSelectionKey(dialogue));
    available = candidates;
  }
  const selected = available[Math.floor(random() * available.length)];
  used.add(dialogueSelectionKey(selected));
  return selected;
}

export function explainDialogue(dialogue: Dialogue): LearningItem[] {
  return dialogue.learning;
}
