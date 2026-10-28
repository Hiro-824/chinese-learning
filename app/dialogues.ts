import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import translatedLines from "./data/lines-translated.json" with { type: "json" };

export type DialogueActor = "npc" | "player";
export type LearningItem = { phrase: string; role: string; meaning: string };
export type Dialogue = {
  id: string;
  zhHans: string;
  ja: string;
  triggerCode: string;
  learning: LearningItem[];
  condition?: string;
};
export type PreviousCapture = {
  to: Square;
  actor: DialogueActor;
  captured: PieceSymbol;
};
export type DialogueContext = {
  playerColor: Color;
  promotion?: PieceSymbol;
  queenReturned?: boolean;
};
export type MaterialHistory = {
  npcWasBehind: boolean;
  playerWasBehind: boolean;
};

export const DIALOGUES: Dialogue[] = translatedLines;
export const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};
export const LONG_ROOK_DISTANCE = 4;
export const REVERSAL_THRESHOLD = 3;

const CAPTURE_TRIGGER = {
  p: { npc: "1", player: "2" },
  n: { npc: "3", player: "4" },
  b: { npc: "5", player: "6" },
  r: { npc: "7", player: "8" },
  q: { npc: "9", player: "10" },
};
const PROMOTION_NAMES: Partial<Record<PieceSymbol, [string, string]>> = {
  q: ["王后", "クイーン"], r: ["车", "ルーク"],
  b: ["象", "ビショップ"], n: ["马", "ナイト"],
};

export function getDialogueCandidates(triggerCode: string, context: DialogueContext) {
  return DIALOGUES.filter((dialogue) => {
    if (dialogue.triggerCode !== triggerCode) return false;
    if (dialogue.condition === "player-white") return context.playerColor === "w";
    if (dialogue.condition === "player-black") return context.playerColor === "b";
    if (dialogue.condition === "queen-returned") return context.queenReturned === true;
    return true;
  }).map((dialogue) => {
    if (!dialogue.zhHans.includes("〇〇")) return dialogue;
    const names = context.promotion && PROMOTION_NAMES[context.promotion];
    if (!names) return null;
    return {
      ...dialogue,
      zhHans: dialogue.zhHans.replaceAll("〇〇", names[0]),
      ja: dialogue.ja.replaceAll("〇〇", names[1]),
      learning: dialogue.learning.map((item) => ({
        ...item,
        phrase: item.phrase.replaceAll("〇〇", names[0]),
        meaning: item.meaning.replaceAll("〇〇", names[1]),
      })),
    };
  }).filter((dialogue): dialogue is Dialogue => dialogue !== null);
}

export function getMaterialBalance(game: Chess, color: Color) {
  return game.board().flat().reduce((sum, piece) => {
    if (!piece) return sum;
    return sum + PIECE_VALUES[piece.type] * (piece.color === color ? 1 : -1);
  }, 0);
}

export function getMaterialReversalTrigger(
  previousBalance: number,
  balance: number,
  history: MaterialHistory,
) {
  // Balances are always from the NPC's perspective. Keep the disadvantage
  // through neutral positions, then consume it when that side reaches +3.
  const npcWasBehind = history.npcWasBehind || previousBalance <= -REVERSAL_THRESHOLD;
  const playerWasBehind = history.playerWasBehind || previousBalance >= REVERSAL_THRESHOLD;
  const npcReversed = npcWasBehind && previousBalance < REVERSAL_THRESHOLD && balance >= REVERSAL_THRESHOLD;
  const playerReversed = playerWasBehind && previousBalance > -REVERSAL_THRESHOLD && balance <= -REVERSAL_THRESHOLD;
  history.npcWasBehind = !npcReversed && (npcWasBehind || balance <= -REVERSAL_THRESHOLD);
  history.playerWasBehind = !playerReversed && (playerWasBehind || balance >= REVERSAL_THRESHOLD);
  return npcReversed ? "29" : playerReversed ? "30" : null;
}

function piecesFor(game: Chess, color: Color) {
  return game.board().flat().filter((piece) => piece?.color === color);
}

export function getMoveDialogueContext(move: Move, playerColor: Color): DialogueContext {
  const before = new Chess(move.before);
  return {
    playerColor,
    promotion: move.promotion,
    queenReturned: move.color === playerColor && move.promotion === "q" &&
      !piecesFor(before, playerColor).some((piece) => piece?.type === "q"),
  };
}

function hasTactic(game: Chess, square: Square, color: Color) {
  const enemy = color === "w" ? "b" : "w";
  // A fork attacks at least two non-pawn targets with the moved piece.
  const targets = piecesFor(game, enemy).filter((piece) =>
    piece && piece.type !== "p" && game.attackers(piece.square, color).includes(square),
  );
  if (targets.length >= 2) return true;

  // Sliding pieces can also pin a piece to its king or skewer a valuable piece.
  const piece = game.get(square);
  if (!piece || !["b", "r", "q"].includes(piece.type)) return false;
  const directions = [
    ...(piece.type !== "b" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : []),
    ...(piece.type !== "r" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : []),
  ];
  for (const [dx, dy] of directions) {
    let first: PieceSymbol | null = null;
    for (let x = square.charCodeAt(0) - 97 + dx, y = Number(square[1]) - 1 + dy;
      x >= 0 && x < 8 && y >= 0 && y < 8; x += dx, y += dy) {
      const target = game.get(`${String.fromCharCode(97 + x)}${y + 1}` as Square);
      if (!target) continue;
      if (target.color === color) break;
      if (first === null) {
        first = target.type;
      } else {
        if ((first !== "k" && target.type === "k") ||
          (first === "k" && PIECE_VALUES[target.type] > 1)) return true;
        break;
      }
    }
  }
  return false;
}

export function getMoveTriggerCode(
  move: Move,
  actor: DialogueActor,
  previousCapture: PreviousCapture | null,
  materialHistory: MaterialHistory,
) {
  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const enemy = move.color === "w" ? "b" : "w";
  const npcColor = actor === "npc" ? move.color : enemy;
  const reversal = getMaterialReversalTrigger(
    getMaterialBalance(before, npcColor), getMaterialBalance(after, npcColor), materialHistory,
  );
  if (after.isCheckmate()) return actor === "player" ? "17" : "18";
  if (move.isPromotion()) return actor === "npc" ? "19" : "20";

  if (piecesFor(before, enemy).length > 1 && piecesFor(after, enemy).length === 1) {
    return actor === "player" ? "21" : "22";
  }
  if (reversal) return reversal;
  if (move.captured && previousCapture && previousCapture.actor !== actor &&
    previousCapture.to === move.to &&
    PIECE_VALUES[previousCapture.captured] === PIECE_VALUES[move.captured]) return "11";
  if (actor === "npc" && hasTactic(after, move.to, move.color) &&
    !hasTactic(before, move.from, move.color)) return "31";
  if (after.isCheck()) return actor === "npc" ? "15" : "16";
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    return actor === "npc" ? "25" : "26";
  }
  if (move.captured && move.captured !== "k") return CAPTURE_TRIGGER[move.captured][actor];
  if (actor === "player" && move.piece === "r") {
    const distance = Math.max(Math.abs(move.from.charCodeAt(0) - move.to.charCodeAt(0)),
      Math.abs(Number(move.from[1]) - Number(move.to[1])));
    if (distance >= LONG_ROOK_DISTANCE) return "28";
  }
  return null;
}

export function getOpeningTriggerCode({ playerColor, firstWithColor, gamesToday, hour }: {
  playerColor: Color; firstWithColor: boolean; gamesToday: number; hour: number;
}) {
  if (firstWithColor) return playerColor === "w" ? "12" : "13";
  if (gamesToday >= 2) return "27";
  if (hour >= 5 && hour < 12) return "23";
  if (hour >= 18 || hour < 5) return "24";
  return "14";
}

export function selectUnusedDialogue(candidates: Dialogue[], used: Set<string>, random = Math.random) {
  if (!candidates.length) return null;
  let available = candidates.filter((dialogue) => !used.has(dialogue.id));
  if (!available.length) {
    for (const dialogue of candidates) used.delete(dialogue.id);
    available = candidates;
  }
  const selected = available[Math.floor(random() * available.length)];
  used.add(selected.id);
  return selected;
}

export function explainDialogue(dialogue: Dialogue): LearningItem[] {
  return dialogue.learning;
}
