// ============================================================
// contentScript.js — Real-Time Speech Transcription
//
// Uses the Chrome Web Speech API (webkitSpeechRecognition)
// to auto-transcribe meeting audio from the microphone.
// Provides both interim (live) and final transcription results.
//
// Also detects Meet page readiness and notifies the background
// service worker so it can start tab capture.
// ============================================================

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

// ── State ──────────────────────────────────────────────────
let recognition      = null;
let isListening      = false;
let isStopped        = false;   // set true when stopListening() is called intentionally
let retryCount       = 0;
const MAX_RETRIES    = 20;      // for non-network fatal errors
const RETRY_DELAY_MS = 2000;    // base retry delay
let networkRetryDelay = 2000;   // grows exponentially on network errors
let restartPending   = false;   // prevents double-restart from onerror + onend

// ── Transcription State ─────────────────────────────────────
let sessionTranscript = [];

// ══════════════════════════════════════════════════════════
// safeSend — chrome.runtime.sendMessage wrapper
//
// WHY: In MV3 the service worker is killed after ~30 s of
// inactivity.  When that happens chrome.runtime.id becomes
// undefined, and chrome.runtime.sendMessage() either throws
// synchronously OR returns undefined (not a Promise).
// Calling .catch() on undefined produces a secondary
// TypeError that escapes any try/catch.
//
// FIX: Check chrome.runtime.id FIRST — this is the official
// Chrome API guard for invalidated extension contexts.
// ══════════════════════════════════════════════════════════
function safeSend(msg) {
  if (!chrome.runtime?.id) return; // context is dead — bail silently
  try {
    chrome.runtime.sendMessage(msg);
  } catch (_) {
    // Swallow — "Extension context invalidated", etc.
  }
}

// ══════════════════════════════════════════════════════════
// persistTranscript — write a final chunk to chrome.storage
// ══════════════════════════════════════════════════════════
async function persistTranscript(chunk) {
  // Guard: chrome.storage is unavailable when context is invalidated
  if (!chrome.runtime?.id) return;
  try {
    const result = await chrome.storage.local.get(["transcriptLog"]);
    const log = result.transcriptLog || [];
    log.push(chunk);
    // Cap at 2000 entries to avoid hitting the 10 MB storage limit
    if (log.length > 2000) log.splice(0, log.length - 2000);
    await chrome.storage.local.set({ transcriptLog: log });
  } catch (err) {
    console.warn("[MeetSense] persistTranscript failed:", err?.message);
  }
}

// ══════════════════════════════════════════════════════════
// initSpeechRecognition — set up the recognition instance
// ══════════════════════════════════════════════════════════
function initSpeechRecognition() {
  // BUG FIX: use safeSend (not raw sendMessage) so this doesn't
  // crash when the context dies right as the page loads.
  if (!SpeechRecognition) {
    console.error("[MeetSense] Web Speech API not supported in this browser.");
    safeSend({ type: "SPEECH_API_NOT_SUPPORTED" });
    return;
  }

  // Avoid re-initialising if already set up
  if (recognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.lang            = "en-US";
  recognition.maxAlternatives = 1;

  // ── onstart ──────────────────────────────────────────────
  recognition.onstart = () => {
    isListening    = true;
    retryCount     = 0;
    restartPending = false;
    // NOTE: Do NOT reset networkRetryDelay here.
    // If we reset it on every onstart, a recognition session that starts
    // briefly then immediately hits a "network" error would reset the
    // backoff every cycle → toast fires every 2 s forever.
    // networkRetryDelay only resets in startListening() after a
    // deliberate (non-error-driven) start.
    console.log("[MeetSense] Speech recognition started.");
    safeSend({ type: "SPEECH_STATUS", status: "listening" });
  };

  // ── onresult ─────────────────────────────────────────────
  recognition.onresult = (event) => {
    let interimText = "";
    let finalText   = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText   += transcript + " ";
      } else {
        interimText += transcript;
      }
    }

    if (interimText.trim()) {
      safeSend({
        type: "NEW_TRANSCRIPTION",
        payload: {
          text:      interimText.trim(),
          isFinal:   false,
          timestamp: Date.now(),
        },
      });
    }

    if (finalText.trim()) {
      const chunk = {
        text:      finalText.trim(),
        isFinal:   true,
        timestamp: Date.now(),
      };

      sessionTranscript.push(chunk);

      safeSend({ type: "NEW_TRANSCRIPTION", payload: chunk });

      // Persist to chrome.storage for summary generation.
      // Not awaited intentionally — fire-and-forget, errors handled inside.
      persistTranscript(chunk);

      // ── Pause-Driven Chunking ────────────────────────────
      // Trigger backend processing right when a sentence ends
      // (isFinal=true). Background script debounces rapid calls.
      safeSend({ type: "SEND_CHUNK_NOW", text: finalText.trim() });
    }
  };

  // ── onerror ──────────────────────────────────────────────
  recognition.onerror = (event) => {
    switch (event.error) {
      case "no-speech":
        // Completely normal — just silence. onend will restart.
        // Don't log as a warning; it floods the console.
        return;

      case "aborted":
        // Triggered by recognition.abort() or an intentional stop.
        isListening = false;
        return;

      case "not-allowed":
        // Microphone permission denied — don't retry.
        isListening = false;
        isStopped   = true; // prevent onend from triggering a restart
        safeSend({ type: "SPEECH_STATUS", status: "mic-denied" });
        return;

      case "network":
        // Transient Chrome STT service error (very common inside Google Meet
        // because Meet's audio pipeline competes with Chrome's STT service).
        // Silent exponential backoff — no user-facing toast, no console.warn
        // (console.warn appears in the extension Errors panel which alarms users).
        console.log(
          `[MeetSense] STT network error — retrying in ${networkRetryDelay} ms`
        );
        isListening = false;
        if (!restartPending) {
          restartPending = true;
          const delay       = networkRetryDelay;
          networkRetryDelay = Math.min(networkRetryDelay * 2, 30000);
          setTimeout(() => {
            restartPending = false;
            startListening();
          }, delay);
        }
        return;

      default:
        console.warn("[MeetSense] Speech recognition error:", event.error);
        isListening = false;
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          if (!restartPending) {
            restartPending = true;
            setTimeout(() => {
              restartPending = false;
              startListening();
            }, RETRY_DELAY_MS);
          }
          safeSend({
            type:   "SPEECH_STATUS",
            status: "error",
            error:  `Speech error: ${event.error} — retrying…`,
          });
        } else {
          // BUG FIX: Don't say "retrying" when we've given up.
          safeSend({
            type:   "SPEECH_STATUS",
            status: "error",
            error:  `Speech recognition failed (${event.error}). Reload the page to try again.`,
          });
        }
        return;
    }
  };

  // ── onend ────────────────────────────────────────────────
  recognition.onend = () => {
    isListening = false;

    // Don't restart if:
    // (a) an onerror handler already queued a restart, or
    // (b) stopListening() was called intentionally by the user.
    if (restartPending || isStopped) return;

    // BUG FIX: 300 ms was too short — Chrome hadn't finished tearing
    // down the old session, causing "already started" errors in start().
    // 600 ms gives Chrome enough time to fully release the session.
    setTimeout(() => startListening(), 600);
  };
}

// ══════════════════════════════════════════════════════════
// startListening
// ══════════════════════════════════════════════════════════
function startListening() {
  if (!recognition) return;

  // BUG FIX: isListening can go stale if Chrome silently kills the
  // recognition session without firing onend. Verify against the
  // actual readyState of the SpeechRecognition object.
  // readyState: 0 = INACTIVE, 1 = ACTIVE, 2 = DONE (non-standard but
  // Chrome exposes it on some builds). Treat anything non-zero as active.
  if (isListening) return;

  isStopped = false; // clear intentional-stop flag on every manual start

  try {
    recognition.start();
  } catch (e) {
    // "already started" is benign — Chrome sometimes fires start() twice
    if (!e.message?.includes("already started")) {
      console.warn("[MeetSense] Start error:", e.message);
    }
  }
}

// ══════════════════════════════════════════════════════════
// stopListening — intentional stop (user action or page tear-down)
// ══════════════════════════════════════════════════════════
function stopListening() {
  if (!recognition) return;
  isStopped = true; // prevent onend from triggering a restart
  try {
    recognition.stop();
  } catch (_) {}
  isListening = false;
}

// ══════════════════════════════════════════════════════════
// waitForMeetLoad — robustly detect when Meet call is active
//
// WHY THE OLD VERSION BROKE: It relied on hardcoded class names
// (.crqnQb, .Tmb7Fd, etc.) that Google Meet rotates every few
// weeks. When those selectors stopped matching, the function
// polled 30 times, found nothing, and silently gave up —
// so initSpeechRecognition() was never called.
//
// NEW APPROACH — 4 layers, any one succeeds:
//   1. Semantic indicators (video/audio elements, call toolbar)
//   2. URL pattern — /xxx-xxxx-xxx = active call
//   3. MutationObserver watching for call UI to appear
//   4. Hard 15s timeout safety net (always starts eventually)
// ══════════════════════════════════════════════════════════
let _transcriptionStarted = false; // prevent double-init

function startTranscription() {
  if (_transcriptionStarted) return;
  _transcriptionStarted = true;
  console.log("[MeetSense] Starting transcription.");
  initSpeechRecognition();
  startListening();
  safeSend({ type: "CONTENT_SCRIPT_READY" });
}

function isMeetCallActive() {
  // Layer 1a: Meet shows a video grid or call toolbar when in a call
  const semanticSelectors = [
    // Call toolbar / control bar (present in any Meet call)
    "[data-call-ended]",
    "[data-allocation-index]",
    // Video/audio elements — always present once call starts
    "video[src]",
    "video.r6xAKc",
    // Participant tiles
    "[data-participant-id]",
    // Leave call button (most reliable — always visible in a call)
    "[aria-label='Leave call']",
    "[data-tooltip-id='leave-call']",
    // Mute/unmute buttons indicating active call
    "[aria-label='Turn off microphone']",
    "[aria-label='Turn on microphone']",
    "[aria-label='Mute microphone']",
    "[aria-label='Unmute microphone']",
    // Meet's main call container
    "div[data-call-started]",
    "div[jsname='CbgAfe']",
  ];

  if (semanticSelectors.some((sel) => document.querySelector(sel))) {
    return true;
  }

  // Layer 1b: Check for multiple video elements (call has started)
  const videos = document.querySelectorAll("video");
  if (videos.length >= 1) return true;

  return false;
}

function isOnCallUrl() {
  // Layer 2: Meet call URLs are meet.google.com/xxx-xxxx-xxx
  // The lobby/home is just meet.google.com or meet.google.com/new
  const path = window.location.pathname;
  return /^\/[a-z]+-[a-z]+-[a-z]+/.test(path);
}

function waitForMeetLoad() {
  let observer = null;
  let safetyTimer = null;
  let pollTimer = null;
  let attempts = 0;
  const MAX_WAIT_MS = 15000; // always start within 15 s no matter what

  function tryStart(reason) {
    if (_transcriptionStarted) return;
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(safetyTimer);
    clearTimeout(pollTimer);
    console.log(`[MeetSense] Meet detected (${reason}). Starting transcription.`);
    startTranscription();
  }

  // ── Layer 3: MutationObserver ───────────────────────────
  // Watches for any DOM change that indicates the call UI appeared.
  observer = new MutationObserver(() => {
    if (isMeetCallActive()) tryStart("DOM mutation");
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Layer 4: Safety net ─────────────────────────────────
  // At worst, start after 15 s. The content script only runs on
  // meet.google.com/* so we're definitely in Meet regardless.
  safetyTimer = setTimeout(() => {
    tryStart("15 s safety timeout");
  }, MAX_WAIT_MS);

  // ── Layer 1 + 2: Active polling (fast path) ─────────────
  function poll() {
    if (_transcriptionStarted) return;
    attempts++;

    if (isMeetCallActive()) {
      tryStart("DOM poll");
      return;
    }

    // URL already shows a call code — Meet is loading, start soon
    if (isOnCallUrl() && attempts >= 3) {
      tryStart("call URL detected");
      return;
    }

    // Keep polling every 500 ms up to the safety timeout
    pollTimer = setTimeout(poll, 500);
  }

  poll();
}

// ══════════════════════════════════════════════════════════
// Message handler from background service worker
// ══════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "START_TRANSCRIPTION":
      // Route through startTranscription() so the _transcriptionStarted
      // guard prevents double-init if background sends this after
      // waitForMeetLoad() already kicked things off.
      startTranscription();
      break;

    case "STOP_TRANSCRIPTION":
      stopListening();
      break;

    case "CLEAR_TRANSCRIPT":
      sessionTranscript = [];
      _transcriptionStarted = false; // allow re-init after session clear
      if (chrome.runtime?.id) {
        chrome.storage.local.set({ transcriptLog: [] });
      }
      break;
  }
});

// ── Boot ──────────────────────────────────────────────────
if (document.readyState === "complete") {
  waitForMeetLoad();
} else {
  window.addEventListener("load", waitForMeetLoad, { once: true });
}

