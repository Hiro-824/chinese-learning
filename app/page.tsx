"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";
import { Chessboard, type ChessboardOptions } from "react-chessboard";
import {
  explainDialogue,
  getMoveTriggerCode,
  loadDialogueSet,
  selectUnusedDialogue,
  shouldAnnounceTrigger,
  type Dialogue,
  type DialogueActor,
  type DialogueSetNumber,
  type PreviousCapture,
} from "./dialogues";

type Difficulty = "beginner" | "intermediate" | "advanced";
type GameStatus = "playing" | "won" | "lost" | "draw";

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "beginner", label: "初級" },
  { value: "intermediate", label: "中級" },
  { value: "advanced", label: "上級" },
];

const ENGINE_SETTINGS: Record<
  Difficulty,
  { skill: number; moveTime: number }
> = {
  beginner: { skill: 0, moveTime: 100 },
  intermediate: { skill: 9, moveTime: 400 },
  advanced: { skill: 18, moveTime: 800 },
};

const DIFFICULTY_KEY = "chess-difficulty";
const STREAK_KEY = "chess-daily-streak";
const DIALOGUE_SET_KEY = "chess-dialogue-set";
const SPEECH_ENABLED_KEY = "chess-speech-enabled";
const FIRST_COLOR_KEY = "chess-first-player-colors";
const MIN_AI_VISIBLE_TIME = 800;
const MIN_DIALOGUE_VISIBLE_TIME = 1800;
const MAX_DIALOGUE_VISIBLE_TIME = 3200;
const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDate(date);
}

function isDifficulty(value: string | null): value is Difficulty {
  return DIFFICULTIES.some((item) => item.value === value);
}

function isDialogueSet(value: number): value is DialogueSetNumber {
  return value >= 1 && value <= 4 && Number.isInteger(value);
}

export default function Home() {
  const chessRef = useRef(new Chess());
  const workerRef = useRef<Worker | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playerColorRef = useRef<Color>("w");
  const statusRef = useRef<GameStatus>("playing");
  const engineReadyRef = useRef(false);
  const thinkingRef = useRef(false);
  const gameIdRef = useRef(0);
  const beginnerCandidatesRef = useRef<Map<number, string>>(new Map());
  const aiMoveTimerRef = useRef<number | null>(null);
  const thinkingStartedAtRef = useRef(0);
  const dialogueSetRef = useRef<DialogueSetNumber>(1);
  const dialoguesRef = useRef<Dialogue[]>([]);
  const usedDialogueIdsRef = useRef(new Set<string>());
  const lastCaptureRef = useRef<PreviousCapture | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const speechEnabledRef = useRef(true);
  const speechPlayingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const speechSafetyTimerRef = useRef<number | null>(null);
  const pendingAiMoveRef = useRef<(() => void) | null>(null);
  const dialogueVisibleUntilRef = useRef(0);
  const beforeNpcDialogueRef = useRef<Dialogue | null>(null);

  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [savedDifficulty, setSavedDifficulty] =
    useState<Difficulty>("beginner");
  const [gameDifficulty, setGameDifficulty] =
    useState<Difficulty>("beginner");
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [fen, setFen] = useState(() => new Chess().fen());
  const [status, setStatus] = useState<GameStatus>("playing");
  const [thinking, setThinking] = useState(false);
  const [lastMove, setLastMove] = useState<[Square, Square] | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [promotion, setPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [streak, setStreak] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [dialogueSet, setDialogueSet] = useState<DialogueSetNumber>(1);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  const [currentDialogue, setCurrentDialogue] = useState<Dialogue | null>(null);
  const [pairedDialogue, setPairedDialogue] = useState<Dialogue | null>(null);
  const [explanationDialogue, setExplanationDialogue] =
    useState<Dialogue | null>(null);

  function finishSpeech(generation: number) {
    if (speechGenerationRef.current !== generation) return;
    if (speechSafetyTimerRef.current !== null) {
      window.clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
    }
    speechPlayingRef.current = false;
    setSpeechPlaying(false);
    const pendingMove = pendingAiMoveRef.current;
    pendingAiMoveRef.current = null;
    pendingMove?.();
  }

  function cancelSpeech(runPendingMove = false) {
    speechGenerationRef.current += 1;
    if (speechSafetyTimerRef.current !== null) {
      window.clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
    }
    speechPlayingRef.current = false;
    setSpeechPlaying(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (runPendingMove) {
      const pendingMove = pendingAiMoveRef.current;
      pendingAiMoveRef.current = null;
      pendingMove?.();
    }
  }

  function speak(text: string, force = false) {
    if ((!force && !speechEnabledRef.current) || !("speechSynthesis" in window)) {
      return;
    }
    try {
      if (speechSafetyTimerRef.current !== null) {
        window.clearTimeout(speechSafetyTimerRef.current);
        speechSafetyTimerRef.current = null;
      }
      window.speechSynthesis.cancel();
      const generation = speechGenerationRef.current + 1;
      speechGenerationRef.current = generation;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 0.78;
      const voices = voicesRef.current;
      utterance.voice =
        voices.find(
          (voice) =>
            /^zh(?:-|_)/i.test(voice.lang) && /google/i.test(voice.name),
        ) ??
        voices.find((voice) => /^zh(?:-|_)CN$/i.test(voice.lang)) ??
        voices.find((voice) => /^zh(?:-|_)/i.test(voice.lang)) ??
        null;
      speechPlayingRef.current = true;
      setSpeechPlaying(true);
      utterance.onend = () => finishSpeech(generation);
      utterance.onerror = () => finishSpeech(generation);
      speechSafetyTimerRef.current = window.setTimeout(
        () => finishSpeech(generation),
        10000,
      );
      window.speechSynthesis.speak(utterance);
    } catch {
      cancelSpeech(true);
      // Dialogue remains usable when speech synthesis is unavailable or blocked.
    }
  }

  function showDialogue(
    dialogue: Dialogue | null,
    previousDialogue?: Dialogue | null,
  ) {
    if (!dialogue) return;
    const readableCharacters = Array.from(dialogue.zhHans).filter(
      (character) => !/[\s，。！？、；：…,.!?;:“”‘’（）()《》]/u.test(character),
    ).length;
    const visibleTime = Math.min(
      MAX_DIALOGUE_VISIBLE_TIME,
      Math.max(MIN_DIALOGUE_VISIBLE_TIME, 900 + readableCharacters * 140),
    );
    dialogueVisibleUntilRef.current = performance.now() + visibleTime;
    setPairedDialogue(previousDialogue ?? null);
    setCurrentDialogue(dialogue);
    speak(dialogue.zhHans);
  }

  function selectDialogue(triggerCode: string) {
    const candidates = dialoguesRef.current.filter(
      (dialogue) => dialogue.triggerCode === triggerCode,
    );
    return selectUnusedDialogue(candidates, usedDialogueIdsRef.current);
  }

  function announceMove(move: Move, actor: DialogueActor) {
    const game = chessRef.current;
    const triggerCode = getMoveTriggerCode(
      {
        actor,
        captured: move.captured,
        to: move.to,
        isCheck: game.isCheck(),
        isCheckmate: game.isCheckmate(),
      },
      lastCaptureRef.current,
    );
    const dialogue =
      triggerCode && shouldAnnounceTrigger(triggerCode, actor)
        ? selectDialogue(triggerCode)
        : null;
    if (actor === "player") {
      beforeNpcDialogueRef.current = dialogue;
      showDialogue(dialogue);
    } else {
      const beforeDialogue = beforeNpcDialogueRef.current;
      beforeNpcDialogueRef.current = null;
      showDialogue(dialogue, beforeDialogue);
    }
    lastCaptureRef.current = move.isCapture()
      ? { to: move.to, actor, captured: move.captured! }
      : null;
  }

  function openingTrigger(color: Color) {
    const key = color === "w" ? "white" : "black";
    try {
      const seen = JSON.parse(localStorage.getItem(FIRST_COLOR_KEY) || "{}") as {
        white?: boolean;
        black?: boolean;
      };
      if (!seen[key]) {
        seen[key] = true;
        localStorage.setItem(FIRST_COLOR_KEY, JSON.stringify(seen));
        return color === "w" ? "2.1" : "2.2";
      }
    } catch {
      // A blocked or invalid localStorage falls back to the regular greeting.
    }
    return "2.3";
  }

  function playMoveSound(isCapture: boolean) {
    try {
      const context = audioRef.current || new AudioContext();
      audioRef.current = context;
      void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(isCapture ? 190 : 410, context.currentTime);
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.075,
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
    } catch {
      // Sound is optional when the browser blocks audio playback.
    }
  }

  function clearAiMoveTimer() {
    if (aiMoveTimerRef.current !== null) {
      window.clearTimeout(aiMoveTimerRef.current);
      aiMoveTimerRef.current = null;
    }
  }

  function readStreak() {
    try {
      const value = JSON.parse(localStorage.getItem(STREAK_KEY) || "null") as {
        date?: string;
        count?: number;
      } | null;
      if (
        value &&
        typeof value.count === "number" &&
        (value.date === localDate() || value.date === yesterday())
      ) {
        return value.count;
      }
    } catch {
      // Ignore an invalid saved value.
    }
    return 0;
  }

  function completeToday() {
    const today = localDate();
    try {
      const previous = JSON.parse(
        localStorage.getItem(STREAK_KEY) || "null",
      ) as { date?: string; count?: number } | null;

      if (previous?.date === today && typeof previous.count === "number") {
        setStreak(previous.count);
        return;
      }

      const count =
        previous?.date === yesterday() && typeof previous.count === "number"
          ? previous.count + 1
          : 1;
      localStorage.setItem(STREAK_KEY, JSON.stringify({ date: today, count }));
      setStreak(count);
    } catch {
      setStreak(1);
    }
  }

  function finishGame(result: Exclude<GameStatus, "playing">) {
    if (statusRef.current !== "playing") return;
    clearAiMoveTimer();
    statusRef.current = result;
    thinkingRef.current = false;
    setStatus(result);
    setThinking(false);
    setSelectedSquare(null);
    setLegalTargets([]);
    setPromotion(null);
    setSettingsOpen(false);
    setResultOpen(true);
    completeToday();
  }

  function checkGameEnd() {
    const game = chessRef.current;
    if (!game.isGameOver()) return false;

    if (game.isCheckmate()) {
      finishGame(game.turn() === playerColorRef.current ? "lost" : "won");
    } else {
      finishGame("draw");
    }
    return true;
  }

  function requestAiMove(difficulty = gameDifficulty) {
    const game = chessRef.current;
    if (
      !engineReadyRef.current ||
      !workerRef.current ||
      thinkingRef.current ||
      statusRef.current !== "playing" ||
      game.turn() === playerColorRef.current ||
      game.isGameOver()
    ) {
      return;
    }

    thinkingRef.current = true;
    thinkingStartedAtRef.current = performance.now();
    beginnerCandidatesRef.current.clear();
    setThinking(true);
    const { moveTime } = ENGINE_SETTINGS[difficulty];
    workerRef.current.postMessage(`position fen ${game.fen()}`);
    workerRef.current.postMessage(`go movetime ${moveTime}`);
  }

  function applyAiMove(uci: string) {
    const game = chessRef.current;
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotedPiece = uci[4] as PieceSymbol | undefined;
    let move: Move;

    try {
      move = game.move({ from, to, promotion: promotedPiece });
      playMoveSound(move.isCapture());
    } catch {
      return;
    }

    setFen(game.fen());
    setLastMove([from, to]);
    announceMove(move, "npc");
    checkGameEnd();
  }

  function chooseBeginnerMove(bestMove: string) {
    const game = chessRef.current;
    if (Math.random() < 0.3) {
      const legalMoves = game.moves({ verbose: true });
      const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      if (move) return `${move.from}${move.to}${move.promotion ?? ""}`;
    }

    const candidates = [...beginnerCandidatesRef.current.entries()]
      .sort(([rankA], [rankB]) => rankA - rankB)
      .map(([, move]) => move);
    if (!candidates.length) return bestMove;

    const index = Math.min(
      candidates.length - 1,
      Math.floor(Math.pow(Math.random(), 0.6) * candidates.length),
    );
    return candidates[index];
  }

  function startGame(difficulty = savedDifficulty) {
    const gameId = gameIdRef.current + 1;
    gameIdRef.current = gameId;
    clearAiMoveTimer();
    workerRef.current?.terminate();

    const color: Color = Math.random() < 0.5 ? "w" : "b";
    const game = new Chess();
    chessRef.current = game;
    playerColorRef.current = color;
    statusRef.current = "playing";
    engineReadyRef.current = false;
    thinkingRef.current = false;
    beginnerCandidatesRef.current.clear();
    usedDialogueIdsRef.current.clear();
    lastCaptureRef.current = null;
    beforeNpcDialogueRef.current = null;
    dialogueVisibleUntilRef.current = 0;
    pendingAiMoveRef.current = null;
    cancelSpeech();

    setGameDifficulty(difficulty);
    setPlayerColor(color);
    setFen(game.fen());
    setStatus("playing");
    setThinking(false);
    setLastMove(null);
    setSelectedSquare(null);
    setLegalTargets([]);
    setPromotion(null);
    setSettingsOpen(false);
    setResultOpen(false);
    setExplanationDialogue(null);
    setPairedDialogue(null);
    setCurrentDialogue(null);

    const worker = new Worker("/stockfish/stockfish-19-lite-single.js");
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<string>) => {
      if (gameIdRef.current !== gameId) return;
      const line = String(data);

      if (line === "readyok") {
        engineReadyRef.current = true;
        requestAiMove(difficulty);
        return;
      }

      if (difficulty === "beginner") {
        const candidate = line.match(
          /\bmultipv\s+(\d+)\b.*\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/,
        );
        if (candidate) {
          beginnerCandidatesRef.current.set(Number(candidate[1]), candidate[2]);
        }
      }

      const bestMove = line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (
        bestMove &&
        thinkingRef.current &&
        aiMoveTimerRef.current === null
      ) {
        const move =
          difficulty === "beginner"
            ? chooseBeginnerMove(bestMove[1])
            : bestMove[1];
        const elapsed = performance.now() - thinkingStartedAtRef.current;
        const dialogueDelay = dialogueVisibleUntilRef.current - performance.now();
        const delay = Math.max(
          0,
          MIN_AI_VISIBLE_TIME - elapsed,
          dialogueDelay,
        );

        aiMoveTimerRef.current = window.setTimeout(() => {
          aiMoveTimerRef.current = null;
          const completeMove = () => {
            if (
              gameIdRef.current !== gameId ||
              statusRef.current !== "playing" ||
              !thinkingRef.current
            ) {
              return;
            }
            thinkingRef.current = false;
            setThinking(false);
            applyAiMove(move);
          };
          if (speechPlayingRef.current) {
            pendingAiMoveRef.current = completeMove;
          } else {
            completeMove();
          }
        }, delay);
      }
    };
    worker.postMessage("uci");
    worker.postMessage(
      `setoption name Skill Level value ${ENGINE_SETTINGS[difficulty].skill}`,
    );
    worker.postMessage(
      `setoption name MultiPV value ${difficulty === "beginner" ? 8 : 1}`,
    );
    worker.postMessage("isready");
    const openingDialogue = selectDialogue(openingTrigger(color));
    showDialogue(openingDialogue);
    beforeNpcDialogueRef.current = color === "b" ? openingDialogue : null;
  }

  useEffect(() => {
    let cancelled = false;
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    const updateVoices = () => {
      voicesRef.current = synth?.getVoices() ?? [];
    };
    updateVoices();
    synth?.addEventListener("voiceschanged", updateVoices);

    const timer = window.setTimeout(async () => {
      const storedDifficulty = localStorage.getItem(DIFFICULTY_KEY);
      const storedSet = Number(localStorage.getItem(DIALOGUE_SET_KEY));
      const initialSet = isDialogueSet(storedSet) ? storedSet : 1;
      const initialSpeech = localStorage.getItem(SPEECH_ENABLED_KEY) !== "false";

      dialogueSetRef.current = initialSet;
      speechEnabledRef.current = initialSpeech;
      setDialogueSet(initialSet);
      setSpeechEnabled(initialSpeech);
      setStreak(readStreak());

      try {
        dialoguesRef.current = await loadDialogueSet(initialSet);
      } catch {
        dialoguesRef.current = [];
      }
      if (cancelled) return;

      if (isDifficulty(storedDifficulty)) {
        setSavedDifficulty(storedDifficulty);
        setIsConfigured(true);
        startGame(storedDifficulty);
      } else {
        setIsConfigured(false);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      clearAiMoveTimer();
      workerRef.current?.terminate();
      void audioRef.current?.close();
      speechGenerationRef.current += 1;
      pendingAiMoveRef.current = null;
      if (speechSafetyTimerRef.current !== null) {
        window.clearTimeout(speechSafetyTimerRef.current);
      }
      synth?.removeEventListener("voiceschanged", updateVoices);
      synth?.cancel();
    };
    // This initialization intentionally runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDifficulty(difficulty: Difficulty) {
    setSavedDifficulty(difficulty);
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
  }

  async function saveDialogueSet(nextSet: DialogueSetNumber) {
    dialogueSetRef.current = nextSet;
    try {
      const loaded = await loadDialogueSet(nextSet);
      if (dialogueSetRef.current === nextSet) {
        dialoguesRef.current = loaded;
        setDialogueSet(nextSet);
        localStorage.setItem(DIALOGUE_SET_KEY, String(nextSet));
      }
    } catch {
      // Keep the currently loaded set if a local JSON file is unavailable.
    }
  }

  function saveSpeechEnabled(enabled: boolean) {
    speechEnabledRef.current = enabled;
    setSpeechEnabled(enabled);
    localStorage.setItem(SPEECH_ENABLED_KEY, String(enabled));
    if (!enabled) cancelSpeech(true);
  }

  function beginFirstGame() {
    saveDifficulty(savedDifficulty);
    setIsConfigured(true);
    startGame(savedDifficulty);
  }

  function showLegalMoves(square: string | null) {
    if (
      !square ||
      statusRef.current !== "playing" ||
      chessRef.current.turn() !== playerColorRef.current ||
      thinkingRef.current ||
      speechPlayingRef.current
    ) {
      setLegalTargets([]);
      return;
    }
    const moves = chessRef.current.moves({
      square: square as Square,
      verbose: true,
    });
    setLegalTargets(moves.map((move) => move.to));
  }

  function handleSquareClick(square: string) {
    if (
      promotion ||
      statusRef.current !== "playing" ||
      thinkingRef.current ||
      speechPlayingRef.current ||
      chessRef.current.turn() !== playerColorRef.current
    ) {
      return;
    }

    const target = square as Square;
    if (selectedSquare && legalTargets.includes(target)) {
      setSelectedSquare(null);
      handleDrop(selectedSquare, target);
      return;
    }

    const piece = chessRef.current.get(target);
    if (piece?.color === playerColorRef.current) {
      setSelectedSquare(target);
      showLegalMoves(target);
    } else {
      setSelectedSquare(null);
      setLegalTargets([]);
    }
  }

  function finishHumanMove(from: Square, to: Square, piece?: PieceSymbol) {
    let move: Move;
    try {
      move = chessRef.current.move({ from, to, promotion: piece });
      playMoveSound(move.isCapture());
    } catch {
      return false;
    }

    setFen(chessRef.current.fen());
    setLastMove([from, to]);
    setSelectedSquare(null);
    setLegalTargets([]);
    setPromotion(null);
    dialogueVisibleUntilRef.current = 0;
    announceMove(move, "player");

    if (!checkGameEnd()) requestAiMove();
    return true;
  }

  function handleDrop(sourceSquare: string, targetSquare: string | null) {
    if (
      !targetSquare ||
      statusRef.current !== "playing" ||
      thinkingRef.current ||
      speechPlayingRef.current ||
      chessRef.current.turn() !== playerColorRef.current
    ) {
      setSelectedSquare(null);
      setLegalTargets([]);
      return false;
    }

    const from = sourceSquare as Square;
    const to = targetSquare as Square;
    const candidate = chessRef.current
      .moves({ square: from, verbose: true })
      .find((move) => move.to === to);

    if (!candidate) {
      setSelectedSquare(null);
      setLegalTargets([]);
      return false;
    }

    if (candidate.isPromotion()) {
      setPromotion({ from, to });
      setSelectedSquare(null);
      setLegalTargets([]);
      return false;
    }

    return finishHumanMove(from, to);
  }

  function resign() {
    if (statusRef.current !== "playing") return;
    workerRef.current?.postMessage("stop");
    finishGame("lost");
  }

  const positionInfo = useMemo(() => {
    const game = new Chess(fen);
    let whiteMaterial = 0;
    let blackMaterial = 0;

    for (const row of game.board()) {
      for (const piece of row) {
        if (!piece) continue;
        if (piece.color === "w") whiteMaterial += PIECE_VALUES[piece.type];
        else blackMaterial += PIECE_VALUES[piece.type];
      }
    }

    const checkedKing = game.isCheck()
      ? (game.findPiece({ color: game.turn(), type: "k" })[0] ?? null)
      : null;

    return {
      materialBalance: whiteMaterial - blackMaterial,
      checkedKing,
      checkedColor: game.isCheck() ? game.turn() : null,
      matedKing: game.isCheckmate() ? checkedKing : null,
    };
  }, [fen]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    const game = new Chess(fen);
    if (lastMove) {
      styles[lastMove[0]] = { backgroundColor: "rgba(250, 204, 21, 0.42)" };
      styles[lastMove[1]] = { backgroundColor: "rgba(250, 204, 21, 0.52)" };
    }
    if (selectedSquare) {
      styles[selectedSquare] = {
        ...styles[selectedSquare],
        backgroundColor: "rgba(52, 132, 82, 0.45)",
      };
    }
    for (const square of legalTargets) {
      const occupied = game.get(square);
      styles[square] = occupied
        ? {
            ...styles[square],
            boxShadow: "inset 0 0 0 5px rgba(34, 92, 59, 0.42)",
          }
        : {
            ...styles[square],
            backgroundImage:
              "radial-gradient(circle, rgba(34, 92, 59, 0.44) 0 16%, transparent 18%)",
          };
    }
    if (positionInfo.checkedKing && positionInfo.checkedColor) {
      const isPlayer = positionInfo.checkedColor === playerColor;
      styles[positionInfo.checkedKing] = {
        ...styles[positionInfo.checkedKing],
        backgroundColor: isPlayer
          ? "rgba(215, 72, 70, 0.68)"
          : "rgba(54, 170, 91, 0.68)",
        boxShadow: `inset 0 0 0 4px ${isPlayer ? "#a62f31" : "#267c43"}`,
      };
    }
    return styles;
  }, [fen, lastMove, legalTargets, playerColor, positionInfo, selectedSquare]);

  const playerBalance =
    playerColor === "w"
      ? positionInfo.materialBalance
      : -positionInfo.materialBalance;
  const playerMaterial = playerBalance > 0 ? `+${playerBalance}` : `${playerBalance}`;

  const boardOptions: ChessboardOptions = {
    position: fen,
    boardOrientation: playerColor === "w" ? "white" : "black",
    boardStyle: { borderRadius: "10px" },
    lightSquareStyle: { backgroundColor: "#f2ead8" },
    darkSquareStyle: { backgroundColor: "#769982" },
    squareStyles,
    animationDurationInMs: 180,
    allowDrawingArrows: false,
    allowAutoScroll: false,
    canDragPiece: ({ piece }) =>
      status === "playing" &&
      !thinking &&
      !speechPlaying &&
      chessRef.current.turn() === playerColor &&
      piece.pieceType[0] === playerColor,
    onPieceDrag: ({ square }) => {
      setSelectedSquare(null);
      showLegalMoves(square);
    },
    onPieceDragCancel: () => setLegalTargets([]),
    onSquareClick: ({ square }) => handleSquareClick(square),
    onPieceDrop: ({ sourceSquare, targetSquare }) =>
      handleDrop(sourceSquare, targetSquare),
    squareRenderer: ({ square, children }) => (
      <div
        className={
          square === positionInfo.matedKing ? "mated-king-square" : undefined
        }
        style={{ width: "100%", height: "100%", ...squareStyles[square] }}
      >
        {children}
      </div>
    ),
  };

  if (isConfigured === null) return <main className="loading-screen" />;

  if (!isConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-box" aria-label="初回設定">
          <h1>Chess</h1>
          <fieldset className="difficulty-field">
            <legend>難易度</legend>
            <DifficultyButtons
              value={savedDifficulty}
              onChange={setSavedDifficulty}
            />
          </fieldset>
          <button className="primary-button" onClick={beginFirstGame}>
            対局開始
          </button>
        </section>
      </main>
    );
  }

  const statusText =
    status === "won"
      ? "勝ち"
      : status === "lost"
        ? "負け"
        : status === "draw"
          ? "引き分け"
          : fen.split(" ")[1] === playerColor
            ? "あなたの手番"
            : "相手の手番";
  const visibleDialogues = currentDialogue
    ? pairedDialogue
      ? [pairedDialogue, currentDialogue]
      : [currentDialogue]
    : [];

  return (
    <main className="game-screen">
      <header className="topbar">
        <span className="streak" aria-label={`連続対局 ${streak} 日`}>
          🔥 {streak} {streak === 1 ? "day" : "days"}
        </span>
        <span
          className={`material-balance ${playerMaterial.startsWith("-") ? "negative" : ""}`}
          aria-label={`マテリアル差 ${playerMaterial}`}
        >
          {playerMaterial}
        </span>
        <button
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          aria-label="設定"
        >
          <GearIcon />
        </button>
      </header>

      <section className="game-area">
        <PlayerRow
          name="Oscar"
          detail={thinking ? "思考中…" : ""}
          reserveDialogueSpace
          dialogues={visibleDialogues}
          onOpenDialogue={setExplanationDialogue}
          onSpeak={(dialogue) => speak(dialogue.zhHans, true)}
        />

        <div className="board-shell">
          <Chessboard options={boardOptions} />
          {promotion && (
            <div className="promotion-picker" aria-label="昇格する駒を選択">
              {(["q", "r", "b", "n"] as PieceSymbol[]).map((piece) => (
                <button
                  key={piece}
                  onClick={() =>
                    finishHumanMove(promotion.from, promotion.to, piece)
                  }
                  aria-label={`${piece}に昇格`}
                >
                  {promotionSymbol(playerColor, piece)}
                </button>
              ))}
            </div>
          )}
        </div>

        <PlayerRow
          name="You"
          detail={statusText}
          active={status === "playing"}
        />

        <div className="controls">
          <button className="primary-button" onClick={() => startGame()}>
            新しい対局
          </button>
          <button
            className="text-button"
            onClick={resign}
            disabled={status !== "playing"}
          >
            投了
          </button>
        </div>
      </section>

      {resultOpen && status !== "playing" && (
        <div
          className="modal-backdrop result-backdrop"
          onPointerDown={() => setResultOpen(false)}
        >
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-label="対局結果"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <strong>
              {status === "won"
                ? "勝ち"
                : status === "lost"
                  ? "負け"
                  : "引き分け"}
            </strong>
            {visibleDialogues.length > 0 && (
              <div className="result-dialogues">
                {visibleDialogues.map((dialogue) => (
                  <div
                    className="result-dialogue"
                    key={`${dialogue.setId}-${dialogue.id}`}
                  >
                    <button
                      className="result-dialogue-text"
                      onClick={() => setExplanationDialogue(dialogue)}
                    >
                      {dialogue.zhHans}
                    </button>
                    <button
                      className="speaker-button"
                      onClick={() => speak(dialogue.zhHans, true)}
                      aria-label="中国語をもう一度聞く"
                    >
                      <SpeakerIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="primary-button" onClick={() => startGame()}>
              新しい対局
            </button>
            <button className="text-button result-close" onClick={() => setResultOpen(false)}>
              最終盤面を見る
            </button>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="設定"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header settings-header">
              <strong>設定</strong>
              <button
                className="close-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <span className="setting-label">難易度</span>
            <DifficultyButtons
              value={savedDifficulty}
              onChange={saveDifficulty}
            />
            <span className="setting-label">セリフセット</span>
            <div className="dialogue-set-buttons">
              {([1, 2, 3, 4] as DialogueSetNumber[]).map((setNumber) => (
                <button
                  type="button"
                  key={setNumber}
                  className={dialogueSet === setNumber ? "selected" : ""}
                  onClick={() => void saveDialogueSet(setNumber)}
                >
                  セット{setNumber}
                </button>
              ))}
            </div>
            <label className="speech-setting">
              <span>
                <strong>自動読み上げ</strong>
                <small>中国語音声</small>
              </span>
              <input
                type="checkbox"
                checked={speechEnabled}
                onChange={(event) => saveSpeechEnabled(event.target.checked)}
              />
            </label>
          </section>
        </div>
      )}

      {explanationDialogue && (
        <ExplanationModal
          dialogue={explanationDialogue}
          onClose={() => setExplanationDialogue(null)}
          onSpeak={() => speak(explanationDialogue.zhHans, true)}
        />
      )}
    </main>
  );
}

function DifficultyButtons({
  value,
  onChange,
}: {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
}) {
  return (
    <div className="difficulty-buttons">
      {DIFFICULTIES.map((difficulty) => (
        <button
          type="button"
          key={difficulty.value}
          className={value === difficulty.value ? "selected" : ""}
          onClick={() => onChange(difficulty.value)}
        >
          {difficulty.label}
        </button>
      ))}
    </div>
  );
}

function PlayerRow({
  name,
  detail,
  active = false,
  reserveDialogueSpace = false,
  dialogues,
  onOpenDialogue,
  onSpeak,
}: {
  name: string;
  detail: string;
  active?: boolean;
  reserveDialogueSpace?: boolean;
  dialogues?: Dialogue[];
  onOpenDialogue?: (dialogue: Dialogue) => void;
  onSpeak?: (dialogue: Dialogue) => void;
}) {
  return (
    <div
      className={`player-row ${reserveDialogueSpace ? "dialogue-player-row" : ""}`}
    >
      <div className={`avatar ${active ? "active" : ""}`} aria-hidden="true">
        {name === "You" ? "Y" : "O"}
      </div>
      <div className="player-copy">
        <strong>{name}</strong>
        <span>{detail || "\u00a0"}</span>
      </div>
      {dialogues && dialogues.length > 0 && onOpenDialogue && onSpeak && (
        <div className="speech-stack">
          {dialogues.map((dialogue) => (
            <div
              className="speech-bubble"
              key={`${dialogue.setId}-${dialogue.id}`}
            >
              <button
                className="speech-text"
                onClick={() => onOpenDialogue(dialogue)}
              >
                <span lang="zh-CN">{dialogue.zhHans}</span>
              </button>
              <button
                className="speaker-button"
                onClick={() => onSpeak(dialogue)}
                aria-label="中国語をもう一度聞く"
              >
                <SpeakerIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExplanationModal({
  dialogue,
  onClose,
  onSpeak,
}: {
  dialogue: Dialogue;
  onClose: () => void;
  onSpeak: () => void;
}) {
  const learningItems = explainDialogue(dialogue);
  return (
    <div className="modal-backdrop explanation-backdrop" onPointerDown={onClose}>
      <section
        className="explanation-modal"
        role="dialog"
        aria-modal="true"
        aria-label="中国語の解説"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header explanation-header">
          <span>中国語の解説</span>
          <button className="close-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="explanation-full-text">
          <div className="explanation-chinese-row">
            <p lang="zh-CN">{dialogue.zhHans}</p>
            <button
              className="speaker-button explanation-speaker"
              onClick={onSpeak}
              aria-label="中国語をもう一度聞く"
            >
              <SpeakerIcon />
            </button>
          </div>
          <p className="explanation-japanese" lang="ja">
            {dialogue.ja}
          </p>
        </div>
        <div className="learning-list" aria-label="単語と表現">
          {learningItems.map((item, index) => (
            <div className="learning-row" key={`${item.phrase}-${index}`}>
              <strong lang="zh-CN">{item.phrase}</strong>
              <span>{item.role}</span>
              <p>{item.meaning}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.7 2h4.6l.55 2.18c.47.2.91.45 1.31.75l2.12-.63 2.3 4-1.57 1.54c.06.38.09.77.09 1.16s-.03.78-.09 1.16l1.57 1.54-2.3 4-2.12-.63c-.4.3-.84.55-1.31.75L14.3 20H9.7l-.55-2.18a7.35 7.35 0 0 1-1.31-.75l-2.12.63-2.3-4 1.57-1.54A7.2 7.2 0 0 1 4.9 11c0-.39.03-.78.09-1.16L3.42 8.3l2.3-4 2.12.63c.4-.3.84-.55 1.31-.75L9.7 2Zm2.3 5.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Zm12.1-.9a5.5 5.5 0 0 1 0 7.8l-1.4-1.4a3.5 3.5 0 0 0 0-5l1.4-1.4Zm2.8-2.8a9.5 9.5 0 0 1 0 13.4l-1.4-1.4a7.5 7.5 0 0 0 0-10.6l1.4-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function promotionSymbol(color: Color, piece: PieceSymbol) {
  const symbols: Record<Color, Record<PieceSymbol, string>> = {
    w: { q: "♕", r: "♖", b: "♗", n: "♘", k: "♔", p: "♙" },
    b: { q: "♛", r: "♜", b: "♝", n: "♞", k: "♚", p: "♟" },
  };
  return symbols[color][piece];
}
