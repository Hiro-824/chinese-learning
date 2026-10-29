"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowTrendingUpIcon,
  Cog6ToothIcon,
  FireIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";
import { Chessboard, type ChessboardOptions } from "react-chessboard";
import {
  getDialogueCandidates,
  getMoveDialogueContext,
  getMoveTriggerCode,
  getOpeningTriggerCode,
  PIECE_VALUES,
  selectUnusedDialogue,
  type Dialogue,
  type DialogueActor,
  type DialogueContext,
  type MaterialHistory,
  type PreviousCapture,
} from "./dialogues";
import { CHARACTER_EXPRESSIONS, getCharacterExpression, type CharacterExpression } from "./character";

import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_STEP,
  ENGINE_MOVE_TIME,
  getDifficultyCommands,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  parseSavedDifficulty,
} from "./difficulty";

type GameStatus = "playing" | "won" | "lost" | "draw";

const DIFFICULTY_KEY = "chess-difficulty";
const STREAK_KEY = "chess-daily-streak";
const SPEECH_ENABLED_KEY = "chess-speech-enabled";
const PINYIN_ENABLED_KEY = "chess-pinyin-enabled";
const JAPANESE_ENABLED_KEY = "chess-japanese-enabled";
const FIRST_COLOR_KEY = "chess-first-player-colors:lines-translated";
const DAILY_GAMES_KEY = "chess-started-games:lines-translated";
const MIN_AI_VISIBLE_TIME = 800;
const MIN_DIALOGUE_VISIBLE_TIME = 1800;
const MAX_DIALOGUE_VISIBLE_TIME = 3200;

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

export default function Home() {
  const chessRef = useRef(new Chess());
  const workerRef = useRef<Worker | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playerColorRef = useRef<Color>("w");
  const statusRef = useRef<GameStatus>("playing");
  const engineReadyRef = useRef(false);
  const thinkingRef = useRef(false);
  const gameIdRef = useRef(0);
  const aiMoveTimerRef = useRef<number | null>(null);
  const thinkingStartedAtRef = useRef(0);
  const usedDialogueIdsRef = useRef(new Set<string>());
  const lastCaptureRef = useRef<PreviousCapture | null>(null);
  const materialHistoryRef = useRef<MaterialHistory>({ npcWasBehind: false, playerWasBehind: false });
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const speechEnabledRef = useRef(true);
  const speechPlayingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const speechSafetyTimerRef = useRef<number | null>(null);
  const pendingAiMoveRef = useRef<(() => void) | null>(null);
  const dialogueVisibleUntilRef = useRef(0);
  const beforeNpcDialogueRef = useRef<Dialogue | null>(null);

  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [savedDifficulty, setSavedDifficulty] = useState(DEFAULT_DIFFICULTY);
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
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [pinyinEnabled, setPinyinEnabled] = useState(true);
  const [japaneseEnabled, setJapaneseEnabled] = useState(true);
  const [currentDialogue, setCurrentDialogue] = useState<Dialogue | null>(null);
  const [pairedDialogue, setPairedDialogue] = useState<Dialogue | null>(null);
  const [characterDialogue, setCharacterDialogue] = useState<Dialogue | null>(null);

  function finishSpeech(generation: number) {
    if (speechGenerationRef.current !== generation) return;
    if (speechSafetyTimerRef.current !== null) {
      window.clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
    }
    speechPlayingRef.current = false;
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
    setCharacterDialogue(dialogue);
    speak(dialogue.zhHans);
  }

  function selectDialogue(
    triggerCode: string,
    context: DialogueContext = { playerColor: playerColorRef.current },
  ) {
    const candidates = getDialogueCandidates(triggerCode, context);
    return selectUnusedDialogue(candidates, usedDialogueIdsRef.current);
  }

  function announceMove(move: Move, actor: DialogueActor) {
    const triggerCode = getMoveTriggerCode(move, actor, lastCaptureRef.current, materialHistoryRef.current);
    const dialogue = triggerCode
      ? selectDialogue(triggerCode, getMoveDialogueContext(move, playerColorRef.current))
      : null;
    if (actor === "player") {
      beforeNpcDialogueRef.current = dialogue;
      showDialogue(dialogue);
    } else {
      const beforeDialogue = beforeNpcDialogueRef.current;
      beforeNpcDialogueRef.current = null;
      showDialogue(dialogue, beforeDialogue);
    }
    lastCaptureRef.current = move.captured
      ? { to: move.to, actor, captured: move.captured! }
      : null;
  }

  function openingTrigger(color: Color) {
    const key = color === "w" ? "white" : "black";
    const now = new Date();
    let firstWithColor = false;
    let gamesToday = 1;
    try {
      const seen = JSON.parse(localStorage.getItem(FIRST_COLOR_KEY) || "{}") as {
        white?: boolean;
        black?: boolean;
      };
      firstWithColor = seen?.[key] !== true;
      localStorage.setItem(FIRST_COLOR_KEY, JSON.stringify({ ...seen, [key]: true }));
    } catch {
      // Without storage, use the time-based greeting.
    }
    try {
      const previous = JSON.parse(localStorage.getItem(DAILY_GAMES_KEY) || "null") as {
        date?: string; count?: number;
      } | null;
      if (previous?.date === localDate(now) && Number.isSafeInteger(previous.count) &&
        previous.count! > 0) gamesToday = previous.count! + 1;
      localStorage.setItem(DAILY_GAMES_KEY, JSON.stringify({ date: localDate(now), count: gamesToday }));
    } catch {
      // Without storage, treat this as today's first game.
    }
    return getOpeningTriggerCode({ playerColor: color, firstWithColor, gamesToday, hour: now.getHours() });
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

  function requestAiMove() {
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
    setThinking(true);
    workerRef.current.postMessage(`position fen ${game.fen()}`);
    workerRef.current.postMessage(`go movetime ${ENGINE_MOVE_TIME}`);
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
    usedDialogueIdsRef.current.clear();
    lastCaptureRef.current = null;
    materialHistoryRef.current = { npcWasBehind: false, playerWasBehind: false };
    beforeNpcDialogueRef.current = null;
    dialogueVisibleUntilRef.current = 0;
    pendingAiMoveRef.current = null;
    cancelSpeech();

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
    setPairedDialogue(null);
    setCurrentDialogue(null);
    setCharacterDialogue(null);

    const worker = new Worker("/stockfish/stockfish-19-lite-single.js");
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<string>) => {
      if (gameIdRef.current !== gameId) return;
      const line = String(data);

      if (line === "readyok") {
        engineReadyRef.current = true;
        requestAiMove();
        return;
      }

      const bestMove = line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (
        bestMove &&
        thinkingRef.current &&
        aiMoveTimerRef.current === null
      ) {
        const move = bestMove[1];
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
    for (const command of getDifficultyCommands(difficulty)) worker.postMessage(command);
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

    const timer = window.setTimeout(() => {
      const storedDifficulty = parseSavedDifficulty(localStorage.getItem(DIFFICULTY_KEY));
      const initialSpeech = localStorage.getItem(SPEECH_ENABLED_KEY) !== "false";

      speechEnabledRef.current = initialSpeech;
      setSpeechEnabled(initialSpeech);
      setPinyinEnabled(localStorage.getItem(PINYIN_ENABLED_KEY) !== "false");
      setJapaneseEnabled(localStorage.getItem(JAPANESE_ENABLED_KEY) !== "false");
      setStreak(readStreak());

      if (cancelled) return;

      if (storedDifficulty !== null) {
        localStorage.setItem(DIFFICULTY_KEY, String(storedDifficulty));
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

  function saveDifficulty(difficulty: number) {
    setSavedDifficulty(difficulty);
    localStorage.setItem(DIFFICULTY_KEY, String(difficulty));
  }

  function saveSpeechEnabled(enabled: boolean) {
    speechEnabledRef.current = enabled;
    setSpeechEnabled(enabled);
    localStorage.setItem(SPEECH_ENABLED_KEY, String(enabled));
    if (!enabled) cancelSpeech(true);
  }

  function savePinyinEnabled(enabled: boolean) {
    setPinyinEnabled(enabled);
    localStorage.setItem(PINYIN_ENABLED_KEY, String(enabled));
  }

  function saveJapaneseEnabled(enabled: boolean) {
    setJapaneseEnabled(enabled);
    localStorage.setItem(JAPANESE_ENABLED_KEY, String(enabled));
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
      thinkingRef.current
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
      styles[lastMove[0]] = { backgroundColor: "var(--board-last-from)" };
      styles[lastMove[1]] = { backgroundColor: "var(--board-last-to)" };
    }
    if (selectedSquare) {
      styles[selectedSquare] = {
        ...styles[selectedSquare],
        backgroundColor: "var(--board-selected)",
      };
    }
    for (const square of legalTargets) {
      const occupied = game.get(square);
      styles[square] = occupied
        ? {
            ...styles[square],
            boxShadow: "inset 0 0 0 4px var(--board-target)",
          }
        : {
            ...styles[square],
            backgroundImage:
              "radial-gradient(circle, var(--board-target) 0 14%, transparent 16%)",
          };
    }
    if (positionInfo.checkedKing && positionInfo.checkedColor) {
      const isPlayer = positionInfo.checkedColor === playerColor;
      styles[positionInfo.checkedKing] = {
        ...styles[positionInfo.checkedKing],
        backgroundColor: isPlayer
          ? "var(--board-check)"
          : "var(--board-selected)",
        boxShadow: `inset 0 0 0 3px ${isPlayer ? "var(--danger)" : "var(--accent)"}`,
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
    boardStyle: { borderRadius: "0" },
    lightSquareStyle: { backgroundColor: "var(--board-light)" },
    darkSquareStyle: { backgroundColor: "var(--board-dark)" },
    showNotation: false,
    squareStyles,
    animationDurationInMs: 180,
    allowDrawingArrows: false,
    allowAutoScroll: false,
    // Small mouse movements during a click should not cancel piece selection.
    dragActivationDistance: 8,
    canDragPiece: ({ piece }) =>
      status === "playing" &&
      !thinking &&
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
          <DifficultySlider value={savedDifficulty} onChange={setSavedDifficulty} />
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
        <button
          className="icon-button menu-button"
          onClick={() => setSettingsOpen(true)}
          aria-label="設定"
          title="設定"
        >
          <Cog6ToothIcon />
        </button>
        <div className="status-capsule">
          <span className="streak" aria-label={`連続対局 ${streak} 日`}>
            <FireIcon />
            <span>{streak} {streak === 1 ? "day" : "days"}</span>
          </span>
          <span
            className={`material-balance ${playerMaterial.startsWith("-") ? "negative" : ""}`}
            aria-label={`マテリアル差 ${playerMaterial}`}
          >
            <ArrowTrendingUpIcon />
            <span>{playerMaterial} <small>pts</small></span>
          </span>
        </div>
      </header>

      <section className="game-area" aria-label="対局">
        <CharacterRow
          dialogues={visibleDialogues}
          expression={getCharacterExpression(characterDialogue)}
          showPinyin={pinyinEnabled}
          showJapanese={japaneseEnabled}
          onSpeak={(dialogue) => {
            setCharacterDialogue(dialogue);
            speak(dialogue.zhHans, true);
          }}
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

        <div className="controls">
          <span className="turn-status" role="status">{statusText}</span>
        </div>
      </section>

      {resultOpen && status !== "playing" && (
        <Modal
          className="result-dialog"
          label="対局結果"
          onClose={() => setResultOpen(false)}
        >
          <div className="result-modal">
            <strong>
              {status === "won"
                ? "勝ち"
                : status === "lost"
                  ? "負け"
                  : "引き分け"}
            </strong>
            <button className="primary-button" onClick={() => startGame()}>
              新しい対局
            </button>
            <button className="text-button result-close" onClick={() => setResultOpen(false)}>
              最終盤面を見る
            </button>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <Modal className="settings-dialog" label="設定" onClose={() => setSettingsOpen(false)}>
          <div className="settings-modal">
            <div className="modal-header settings-header">
              <strong>設定</strong>
              <button
                className="close-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="閉じる"
              >
                <XMarkIcon />
              </button>
            </div>
            <DifficultySlider
              value={savedDifficulty}
              onChange={saveDifficulty}
              nextGame
            />
            <SettingsToggle
              label="拼音を表示"
              description="オフにすると漢字を大きく表示"
              checked={pinyinEnabled}
              onChange={savePinyinEnabled}
            />
            <SettingsToggle
              label="日本語訳を表示"
              description="漢字の下に表示"
              checked={japaneseEnabled}
              onChange={saveJapaneseEnabled}
            />
            <SettingsToggle
              label="自動読み上げ"
              description="中国語音声"
              checked={speechEnabled}
              onChange={saveSpeechEnabled}
            />
          </div>
        </Modal>
      )}
    </main>
  );
}

function SettingsToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Modal({
  children,
  className,
  label,
  onClose,
}: {
  children: ReactNode;
  className: string;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`app-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}

function DifficultySlider({
  value,
  onChange,
  nextGame = false,
}: {
  value: number;
  onChange: (value: number) => void;
  nextGame?: boolean;
}) {
  const id = useId();
  return (
    <div className="difficulty-control">
      <div className="difficulty-heading">
        <label htmlFor={id}>難易度</label>
        <output htmlFor={id}>{value}<span> / {MAX_DIFFICULTY}</span></output>
      </div>
      <input
        id={id}
        className="difficulty-slider"
        style={{
          "--slider-progress": `${(value - MIN_DIFFICULTY) / (MAX_DIFFICULTY - MIN_DIFFICULTY) * 100}%`,
        } as CSSProperties}
        type="range"
        min={MIN_DIFFICULTY}
        max={MAX_DIFFICULTY}
        step={DIFFICULTY_STEP}
        value={value}
        aria-valuetext={`${value} / ${MAX_DIFFICULTY}`}
        aria-describedby={nextGame ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <div className="difficulty-scale" aria-hidden="true">
        <span>やさしい</span><span>手強い</span>
      </div>
      {nextGame && <p id={`${id}-hint`} className="difficulty-hint">次の対局から適用</p>}
    </div>
  );
}

function CharacterRow({
  dialogues,
  expression,
  showPinyin,
  showJapanese,
  onSpeak,
}: {
  dialogues?: Dialogue[];
  expression: CharacterExpression;
  showPinyin: boolean;
  showJapanese: boolean;
  onSpeak?: (dialogue: Dialogue) => void;
}) {
  return (
    <div className="character-row">
      <div
        className="character-portrait"
        role="img"
        aria-label={`Oscar：${CHARACTER_EXPRESSIONS[expression].label}`}
        data-expression={expression}
      >
        {Object.entries(CHARACTER_EXPRESSIONS).map(([name, portrait]) => (
          <Image
            key={name}
            className={`character-image${name === expression ? " is-active" : ""}`}
            src={portrait.src}
            alt=""
            fill
            sizes="144px"
            unoptimized
            loading="eager"
            draggable={false}
          />
        ))}
      </div>
      {dialogues && dialogues.length > 0 && onSpeak && (
        <div className="speech-stack">
          {dialogues.map((dialogue) => (
            <div
              className="speech-bubble"
              key={dialogue.id}
            >
              <a
                className="speech-text"
                href={`https://www.google.com/search?${new URLSearchParams({ q: `${dialogue.zhHans}を品詞分解`, udm: "50", hl: "ja" })}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${dialogue.zhHans}を品詞分解（Google AIモードを新しいタブで開く）`}
                title="Google AIモードで品詞分解を調べる（新しいタブ）"
              >
                {showPinyin && (
                  <span className="speech-pinyin speech-primary" lang="zh-Latn-pinyin">{dialogue.pinyin}</span>
                )}
                <span className={`speech-chinese${showPinyin ? "" : " speech-primary"}`} lang="zh-CN">{dialogue.zhHans}</span>
                {showJapanese && (
                  <span className="speech-japanese" lang="ja">{dialogue.ja}</span>
                )}
              </a>
              <button
                className="speaker-button"
                onClick={() => onSpeak(dialogue)}
                aria-label="中国語をもう一度聞く"
              >
                <SpeakerWaveIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function promotionSymbol(color: Color, piece: PieceSymbol) {
  const symbols: Record<Color, Record<PieceSymbol, string>> = {
    w: { q: "♕", r: "♖", b: "♗", n: "♘", k: "♔", p: "♙" },
    b: { q: "♛", r: "♜", b: "♝", n: "♞", k: "♚", p: "♟" },
  };
  return symbols[color][piece];
}
