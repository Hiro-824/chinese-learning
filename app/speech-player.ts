export const SPEECH_LOAD_TIMEOUT = 30000;
const PLAYBACK_GRACE_TIME = 5000;

export type SpeechFailure = "blocked" | "unavailable" | "timeout";
type Timer = ReturnType<typeof setTimeout>;
type Environment = {
  createAudio: () => HTMLAudioElement;
  setTimer: (callback: () => void, delay: number) => Timer;
  clearTimer: (timer: Timer) => void;
};

// Reuse one media element, and keep loading/buffering time separate from playback.
export class SpeechPlayer {
  private audio: HTMLAudioElement | null = null;
  private timer: Timer | null = null;
  private generation = 0;
  private environment: Environment;

  constructor(environment: Partial<Environment> = {}) {
    this.environment = {
      createAudio: () => new Audio(),
      setTimer: (callback, delay) => setTimeout(callback, delay),
      clearTimer: (timer) => clearTimeout(timer),
      ...environment,
    };
  }

  private clearTimer() {
    if (this.timer !== null) this.environment.clearTimer(this.timer);
    this.timer = null;
  }

  private resetAudio() {
    if (!this.audio) return;
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.onplaying = null;
    this.audio.onwaiting = null;
    this.audio.onstalled = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  stop() {
    this.generation++;
    this.clearTimer();
    this.resetAudio();
  }

  dispose() {
    this.stop();
    this.audio = null;
  }

  play(src: string, onFinish: () => void, onFailure: (reason: SpeechFailure) => void) {
    this.stop();
    const generation = this.generation;
    let attempt = 0;
    let retries = 0;
    const current = () => this.generation === generation;
    const finish = (reason?: SpeechFailure) => {
      if (!current()) return;
      this.stop();
      if (reason) onFailure(reason);
      onFinish();
    };
    const start = () => {
      if (!current()) return;
      const thisAttempt = ++attempt;
      const active = () => current() && attempt === thisAttempt;
      let waiting = false;
      const fail = (reason: SpeechFailure, retryable: boolean) => {
        if (!active()) return;
        // Invalidate this attempt before load() rejects its pending play promise.
        attempt++;
        this.clearTimer();
        this.resetAudio();
        if (retryable && retries++ === 0) start();
        else finish(reason);
      };
      const waitForData = () => {
        if (!active() || waiting) return;
        waiting = true;
        this.clearTimer();
        this.timer = this.environment.setTimer(() => fail("timeout", true), SPEECH_LOAD_TIMEOUT);
      };
      try {
        const audio = this.audio ?? this.environment.createAudio();
        this.audio = audio;
        audio.preload = "auto";
        audio.src = src;
        audio.onended = () => { if (active()) finish(); };
        // Chrome can classify an initial fetch failure as SRC_NOT_SUPPORTED (4).
        // Our sources are known M4A recordings, so retry that case once too.
        audio.onerror = () => fail("unavailable", audio.error?.code === 2 || audio.error?.code === 4);
        audio.onplaying = () => {
          if (!active()) return;
          waiting = false;
          this.clearTimer();
          const remaining = audio.duration - audio.currentTime;
          const timeout = Number.isFinite(remaining)
            ? Math.max(10000, remaining * 1000 + PLAYBACK_GRACE_TIME)
            : 30000;
          this.timer = this.environment.setTimer(() => fail("timeout", false), timeout);
        };
        audio.onwaiting = waitForData;
        audio.onstalled = waitForData;
        waitForData();
        void audio.play().catch((error: unknown) => {
          if (!active()) return;
          const name = error instanceof Error ? error.name : "";
          fail(name === "NotAllowedError" ? "blocked" : "unavailable", name !== "NotAllowedError");
        });
      } catch {
        fail("unavailable", false);
      }
    };
    start();
  }
}
