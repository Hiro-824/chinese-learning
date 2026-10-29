import { customPinyin, pinyin } from "pinyin-pro";

// Readings and neutral tones for the vocabulary used in these dialogues.
customPinyin({
  收拾: "shōu shi", 东西: "dōng xi", 朋友: "péng you",
  告诉: "gào su", 关系: "guān xi", 厉害: "lì hai",
  眼睛: "yǎn jing", 主意: "zhǔ yi", 意思: "yì si", 时候: "shí hou",
  只剩: "zhǐ shèng", 起得: "qǐ de", 睡得: "shuì de", 跑得: "pǎo de",
  教过: "jiāo guo", 谁教: "shuí jiāo", 谁干: "shuí gàn",
  宁有种乎: "nìng yǒu zhǒng hū",
});

const punctuation = { "，": ",", "。": ".", "！": "!", "？": "?", "；": ";", "：": ":" };

export function generateDialoguePinyin(text) {
  // Preserve the promotion placeholder: 〇 here is not the number zero.
  const result = text.split("〇〇")
    .map((part) => pinyin(part, { toneType: "symbol", toneSandhi: true }))
    .join(" 〇〇 ")
    .replace(/[，。！？；：]/gu, (mark) => punctuation[mark])
    .replace(/\s+([,.!?;:…])/gu, "$1")
    .replaceAll("nǎ ér", "nǎr")
    .replaceAll("zhè ér", "zhèr")
    .replaceAll("nà ér", "nàr")
    .replaceAll("diǎn er", "diǎnr")
    .trim();
  return result.replace(/(^|[.!?]\s+)(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase());
}
