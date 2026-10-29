import assert from "node:assert/strict";
import test from "node:test";
import { SPEECH_LOAD_TIMEOUT, SpeechPlayer } from "./speech-player.ts";

function harness() {
  let now = 0;
  let nextTimer = 0;
  let created = 0;
  const timers = new Map();
  const requests = [];
  const finished = [];
  const failures = [];
  const audio = {
    duration: 2, currentTime: 0, error: null, paused: false,
    pause() { this.paused = true; },
    removeAttribute() { this.src = ""; },
    load() {},
    play() {
      this.paused = false;
      return new Promise((resolve, reject) => requests.push({ src: this.src, resolve, reject }));
    },
  };
  const player = new SpeechPlayer({
    createAudio: () => { created++; return audio; },
    setTimer: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    player, audio, requests, finished, failures,
    created: () => created,
    play: (src = "/voice/test.m4a") => player.play(src, () => finished.push(src), (reason) => failures.push(reason)),
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id); now = timer.at; timer.callback();
      }
      now = until;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a 12-second initial load does not consume the playback timeout", () => {
  const h = harness(); h.play(); h.advance(12000);
  assert.equal(h.audio.paused, false);
  assert.deepEqual(h.finished, []);
  h.audio.onplaying(); h.advance(2000); h.audio.onended();
  assert.equal(h.finished.length, 1); assert.deepEqual(h.failures, []);
});

test("buffering gets its own loading allowance, and long recordings are not cut at ten seconds", () => {
  const h = harness(); h.audio.duration = 20; h.play(); h.audio.onplaying();
  h.advance(12000); assert.equal(h.finished.length, 0);
  h.audio.currentTime = 12; h.audio.onwaiting(); h.advance(15000);
  assert.equal(h.finished.length, 0);
  h.audio.onplaying(); h.advance(8000); h.audio.onended();
  assert.equal(h.finished.length, 1); assert.deepEqual(h.failures, []);
});

test("a transient media network error retries once and ignores the abandoned play rejection", async () => {
  const h = harness(); h.play(); h.audio.error = { code: 2 }; h.audio.onerror();
  assert.equal(h.requests.length, 2); assert.equal(h.created(), 1);
  h.requests[0].reject(new DOMException("Old load was aborted", "AbortError")); await flush();
  assert.deepEqual(h.finished, []);
  h.audio.onplaying(); h.audio.onended();
  assert.equal(h.finished.length, 1); assert.deepEqual(h.failures, []);
});

test("repeated network failures end once and release the waiting move", async () => {
  const h = harness(); h.play(); h.audio.error = { code: 2 }; h.audio.onerror(); h.audio.onerror();
  assert.equal(h.requests.length, 2); assert.equal(h.finished.length, 1);
  assert.deepEqual(h.failures, ["unavailable"]);
  for (const request of h.requests) request.reject(new Error("Network failed"));
  await flush(); assert.equal(h.finished.length, 1);
});

test("autoplay denial is reported immediately, and unsupported-source errors get at most one retry", async () => {
  const blocked = harness(); blocked.play();
  blocked.requests[0].reject(new DOMException("Playback failed", "NotAllowedError")); await flush();
  assert.equal(blocked.requests.length, 1); assert.deepEqual(blocked.failures, ["blocked"]);
  const unsupported = harness(); unsupported.play();
  for (let attempt = 0; attempt < 2; attempt++) {
    unsupported.requests[attempt].reject(new DOMException("Fetch failed", "NotSupportedError")); await flush();
  }
  assert.equal(unsupported.requests.length, 2); assert.deepEqual(unsupported.failures, ["unavailable"]);
  const fetchFailure = harness(); fetchFailure.play(); fetchFailure.audio.error = { code: 4 };
  fetchFailure.audio.onerror(); assert.equal(fetchFailure.requests.length, 2);
  fetchFailure.audio.onplaying(); fetchFailure.audio.onended(); assert.deepEqual(fetchFailure.failures, []);
  const decodeFailure = harness(); decodeFailure.play(); decodeFailure.audio.error = { code: 3 }; decodeFailure.audio.onerror();
  assert.equal(decodeFailure.requests.length, 1); assert.deepEqual(decodeFailure.failures, ["unavailable"]);
});

test("switching voice or replaying ignores stale events and uses the same media element", async () => {
  const h = harness(); h.play("/voice/1.m4a");
  const oldEnd = h.audio.onended; const oldError = h.audio.onerror;
  h.play("/voice/2.m4a");
  oldEnd(); oldError(); h.requests[0].reject(new DOMException("Replaced", "AbortError")); await flush();
  assert.equal(h.audio.src, "/voice/2.m4a"); assert.equal(h.created(), 1);
  assert.deepEqual(h.finished, []); assert.deepEqual(h.failures, []);
  h.audio.onplaying(); h.audio.onended(); assert.deepEqual(h.finished, ["/voice/2.m4a"]);
});

test("unresponsive loads retry once then time out; stopping and disposal never run pending moves", () => {
  const h = harness(); h.play(); h.advance(SPEECH_LOAD_TIMEOUT);
  assert.equal(h.requests.length, 2); assert.deepEqual(h.finished, []);
  h.advance(SPEECH_LOAD_TIMEOUT); assert.deepEqual(h.failures, ["timeout"]); assert.equal(h.finished.length, 1);
  h.play(); h.player.stop(); h.advance(120000); assert.equal(h.finished.length, 1);
  h.play(); h.player.dispose(); h.advance(120000); assert.equal(h.finished.length, 1);
});
