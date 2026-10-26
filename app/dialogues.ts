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
  target?: DialogueActor;
  source: "set" | "generic";
  setId?: DialogueSetNumber;
};

export type PreviousCapture = {
  to: Square;
  actor: DialogueActor;
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
    previousCapture.to === event.to
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
  const response = await fetch(
    `/data/line/chess_set_${String(setId).padStart(2, "0")}.json`,
  );
  if (!response.ok) throw new Error(`Dialogue set ${setId} could not be loaded`);

  const data = (await response.json()) as RawDialogueSet;
  const dialogues: Dialogue[] = [];
  for (const expression of data.expressions ?? []) {
    for (const item of expression.dialogues ?? []) {
      if (
        typeof item.id === "string" &&
        typeof item.text?.zhHans === "string" &&
        typeof item.text.ja === "string" &&
        typeof item.trigger?.code === "string"
      ) {
        dialogues.push({
          id: item.id,
          zhHans: item.text.zhHans,
          ja: item.text.ja,
          triggerCode: item.trigger.code,
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

function generic(
  id: string,
  target: DialogueActor,
  zhHans: string,
  ja: string,
): Dialogue {
  return {
    id,
    target,
    zhHans,
    ja,
    triggerCode: "normal",
    source: "generic",
  };
}

// These lines never claim anything about the position. The target is the side
// whose just-completed move caused Oscar to speak.
export const GENERIC_DIALOGUES: Dialogue[] = [
  generic("normal-player-01", "player", "哦？", "おや？"),
  generic("normal-player-02", "player", "这样啊。", "なるほどね。"),
  generic("normal-player-03", "player", "我看见了。", "見たよ。"),
  generic("normal-player-04", "player", "好，轮到我了。", "よし、僕の番だ。"),
  generic("normal-player-05", "player", "有意思。", "面白いね。"),
  generic("normal-player-06", "player", "你这么走啊。", "そう指すんだね。"),
  generic("normal-player-07", "player", "嗯，我想想。", "うん、考えてみよう。"),
  generic("normal-player-08", "player", "这一步，我记住了。", "この一手、覚えたよ。"),
  generic("normal-player-09", "player", "别急，让我看看。", "まあ待って、見せて。"),
  generic("normal-player-10", "player", "原来如此。", "なるほど、そういうことか。"),
  generic("normal-player-11", "player", "继续吧。", "続けよう。"),
  generic("normal-player-12", "player", "好吧，该我了。", "いいよ、僕の番だ。"),
  generic("normal-player-13", "player", "挺有意思。", "なかなか面白いね。"),
  generic("normal-player-14", "player", "你很认真嘛。", "ずいぶん真剣だね。"),
  generic("normal-player-15", "player", "我得想一想。", "ちょっと考えないと。"),
  generic("normal-player-16", "player", "行，我知道了。", "うん、わかったよ。"),
  generic("normal-player-17", "player", "这就来。", "今いくよ。"),
  generic("normal-player-18", "player", "让我看看……", "ちょっと見せて……"),
  generic("normal-player-19", "player", "嗯……轮到我。", "うーん……僕の番だ。"),
  generic("normal-player-20", "player", "好，接着来。", "よし、続けよう。"),
  generic("normal-npc-01", "npc", "到你了。", "君の番だ。"),
  generic("normal-npc-02", "npc", "该你了。", "君の番だよ。"),
  generic("normal-npc-03", "npc", "我走好了。", "指し終わったよ。"),
  generic("normal-npc-04", "npc", "接着来吧。", "続けよう。"),
  generic("normal-npc-05", "npc", "就这样。", "これでいこう。"),
  generic("normal-npc-06", "npc", "先走这一步。", "まずはこの一手。"),
  generic("normal-npc-07", "npc", "好，轮到你。", "よし、君の番だ。"),
  generic("normal-npc-08", "npc", "请吧。", "どうぞ。"),
  generic("normal-npc-09", "npc", "我下完了。", "僕は指し終わったよ。"),
  generic("normal-npc-10", "npc", "嗯，就这么走。", "うん、こう指そう。"),
  generic("normal-npc-11", "npc", "来，继续。", "さあ、続けよう。"),
  generic("normal-npc-12", "npc", "你的回合。", "君の番だ。"),
  generic("normal-npc-13", "npc", "我走这里。", "ここに指すよ。"),
  generic("normal-npc-14", "npc", "下一步看你的。", "次は君の番だ。"),
  generic("normal-npc-15", "npc", "好了，请继续。", "よし、続けて。"),
  generic("normal-npc-16", "npc", "这一步先放这儿。", "この一手はここに置こう。"),
  generic("normal-npc-17", "npc", "棋局还在继续。", "対局はまだ続くよ。"),
  generic("normal-npc-18", "npc", "慢慢来。", "ゆっくりどうぞ。"),
  generic("normal-npc-19", "npc", "我先这样走。", "ひとまずこう指すよ。"),
  generic("normal-npc-20", "npc", "好啦，到你。", "はい、君の番。"),
];

type DictionaryEntry = Omit<LearningItem, "phrase">;

const DICTIONARY: Record<string, DictionaryEntry> = {
  "准备好……了吗": { role: "文型", meaning: "〜の準備はできた？" },
  "让我看看": { role: "表現", meaning: "ちょっと見せて、考えさせて" },
  "原来如此": { role: "定型表現", meaning: "なるほど、そういうことか" },
  "有意思": { role: "形容詞句", meaning: "面白い、興味深い" },
  "轮到我了": { role: "表現", meaning: "僕の番になった" },
  "轮到你": { role: "表現", meaning: "君の番になる" },
  "你的回合": { role: "チェス用語", meaning: "君の手番" },
  "接着来": { role: "表現", meaning: "続けよう、次へ進もう" },
  "我想想": { role: "表現", meaning: "ちょっと考えるよ" },
  "想一想": { role: "動詞句", meaning: "少し考えてみる" },
  "我知道了": { role: "表現", meaning: "わかった、了解した" },
  "这一步": { role: "チェス用語", meaning: "この一手" },
  "下一步": { role: "チェス用語", meaning: "次の一手" },
  "这么走": { role: "チェス表現", meaning: "このように駒を動かす、こう指す" },
  "这样走": { role: "チェス表現", meaning: "このように駒を動かす、こう指す" },
  "我走好了": { role: "チェス表現", meaning: "僕は指し終えた" },
  "我下完了": { role: "チェス表現", meaning: "僕は指し終えた" },
  "慢慢来": { role: "定型表現", meaning: "ゆっくりやって、焦らないで" },
  "将军": { role: "チェス用語", meaning: "チェックする、王手をかける" },
  "将死": { role: "チェス用語", meaning: "チェックメイトする" },
  "国际象棋": { role: "名詞", meaning: "チェス" },
  "棋局": { role: "名詞", meaning: "チェスなどの対局、局面" },
  "回合": { role: "名詞", meaning: "順番、手番" },
  "准备好": { role: "動詞句", meaning: "準備ができる" },
  "没想到": { role: "表現", meaning: "思いもよらなかった" },
  "看起来": { role: "表現", meaning: "〜のように見える" },
  "不要紧": { role: "定型表現", meaning: "大丈夫、気にしないで" },
  "没关系": { role: "定型表現", meaning: "大丈夫、かまわない" },
  "你好": { role: "あいさつ", meaning: "こんにちは、やあ" },
  "再见": { role: "あいさつ", meaning: "さようなら、またね" },
  "好吧": { role: "応答", meaning: "まあいい、わかった" },
  "好了": { role: "表現", meaning: "よし、できた" },
  "好啦": { role: "表現", meaning: "はい、できたよ" },
  "这样啊": { role: "応答", meaning: "そうなんだ、なるほど" },
  "就这样": { role: "表現", meaning: "このようにする、これでいく" },
  "我看看": { role: "表現", meaning: "ちょっと見てみる、考えてみる" },
  "我记住了": { role: "動詞句", meaning: "覚えた" },
  "我看见了": { role: "動詞句", meaning: "見えた、見た" },
  "别急": { role: "表現", meaning: "焦らないで、ちょっと待って" },
  "继续": { role: "動詞", meaning: "続ける" },
  "认真": { role: "形容詞", meaning: "真剣だ、まじめだ" },
  "知道": { role: "動詞", meaning: "知る、わかる" },
  "记住": { role: "動詞", meaning: "しっかり覚える" },
  "看见": { role: "動詞", meaning: "目に入る、見える" },
  "看看": { role: "動詞", meaning: "ちょっと見る、見てみる" },
  "想想": { role: "動詞", meaning: "ちょっと考える" },
  "轮到": { role: "動詞", meaning: "順番が回ってくる" },
  "走": { role: "動詞", meaning: "歩く、行く。チェスでは駒を動かす・指す" },
  "下": { role: "動詞", meaning: "下る、置く。ゲームではプレイする・指す" },
  "吃": { role: "動詞", meaning: "食べる。チェスでは相手の駒を取る" },
  "输": { role: "動詞", meaning: "負ける" },
  "赢": { role: "動詞", meaning: "勝つ" },
  "开始": { role: "動詞", meaning: "始める、始まる" },
  "结束": { role: "動詞", meaning: "終える、終わる" },
  "一步": { role: "数量表現", meaning: "一歩。チェスでは一手" },
  "一手": { role: "数量表現", meaning: "一手" },
  "这里": { role: "場所表現", meaning: "ここ" },
  "这儿": { role: "場所表現", meaning: "ここ" },
  "先": { role: "副詞", meaning: "先に、まず" },
  "再": { role: "副詞", meaning: "再び、さらに、それから" },
  "还": { role: "副詞", meaning: "まだ、さらに" },
  "很": { role: "副詞", meaning: "とても。形容詞を自然につなぐ働きもする" },
  "挺": { role: "副詞", meaning: "なかなか、とても" },
  "得": { role: "助動詞", meaning: "〜しなければならない" },
  "该": { role: "助動詞", meaning: "〜する番だ、〜すべきだ" },
  "吧": { role: "語気助詞", meaning: "提案や柔らかな推量を表す" },
  "了": { role: "助詞", meaning: "変化や完了を表す" },
  "吗": { role: "語気助詞", meaning: "疑問を表す" },
  "嘛": { role: "語気助詞", meaning: "当然さや軽い強調を表す" },
  "啊": { role: "語気助詞", meaning: "語調を柔らげたり感情を添えたりする" },
  "我": { role: "代名詞", meaning: "私、僕" },
  "你": { role: "代名詞", meaning: "あなた、君" },
  "好": { role: "形容詞・応答", meaning: "よい。応答では「わかった、よし」" },
  "嗯": { role: "間投詞", meaning: "うん、うーん" },
  "哦": { role: "間投詞", meaning: "おや、ああ" },
  "来": { role: "動詞", meaning: "来る。呼びかけでは「さあ」" },
  "请": { role: "動詞・丁寧表現", meaning: "どうぞ、〜してください" },
};

// Add exact per-line corrections here when a dictionary-based explanation is
// not sufficient. Keys are `${setId}:${dialogueId}` or a generic dialogue ID.
export const DIALOGUE_LEARNING_OVERRIDES: Record<string, LearningItem[]> = {
  "4:1-dialogue-2": [
    { phrase: "你好", role: "あいさつ", meaning: "やあ、こんにちは" },
    {
      phrase: "准备好……了吗？",
      role: "文型",
      meaning: "〜する準備はできた？",
    },
    { phrase: "输", role: "動詞", meaning: "負ける" },
  ],
};

const PUNCTUATION = /^[\s，。！？、；：…,.!?;:“”‘’（）()《》]+/u;
const DICTIONARY_PHRASES = Object.keys(DICTIONARY).sort(
  (left, right) => right.length - left.length,
);

export function explainDialogue(dialogue: Dialogue): LearningItem[] {
  const overrideKey =
    dialogue.source === "set" ? `${dialogue.setId}:${dialogue.id}` : dialogue.id;
  const override = DIALOGUE_LEARNING_OVERRIDES[overrideKey];
  if (override) return override;

  const result: LearningItem[] = [];
  let remaining = dialogue.zhHans;
  while (remaining) {
    const punctuation = remaining.match(PUNCTUATION)?.[0];
    if (punctuation) {
      remaining = remaining.slice(punctuation.length);
      continue;
    }

    const known = DICTIONARY_PHRASES.find((phrase) =>
      remaining.startsWith(phrase),
    );
    if (known) {
      result.push({ phrase: known, ...DICTIONARY[known] });
      remaining = remaining.slice(known.length);
      continue;
    }

    let boundary = 1;
    while (boundary < remaining.length) {
      const rest = remaining.slice(boundary);
      if (
        PUNCTUATION.test(rest) ||
        DICTIONARY_PHRASES.some((phrase) => rest.startsWith(phrase))
      ) {
        break;
      }
      boundary += 1;
    }
    result.push({
      phrase: remaining.slice(0, boundary),
      role: "語句",
      meaning: "意味未登録",
    });
    remaining = remaining.slice(boundary);
  }

  return result.length
    ? result
    : [{ phrase: dialogue.zhHans, role: "語句", meaning: "意味未登録" }];
}
