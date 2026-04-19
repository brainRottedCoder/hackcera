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

let recognition = null;
let isListening = false;
let retryCount = 0;
const MAX_RETRIES = 20;      // for non-network fatal errors
const RETRY_DELAY_MS = 2000; // retry delay

// ── Transcription State ──
let sessionTranscript = [];

function initSpeechRecognition() {
  if (!SpeechRecognition) {
    console.error(
      "[MeetSense] Web Speech API not supported in this browser."
    );
    chrome.runtime.sendMessage({
      type: "SPEECH_API_NOT_SUPPORTED",
    });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    retryCount = 0;
    console.log("[MeetSense] Speech recognition started.");
    chrome.runtime.sendMessage({ type: "SPEECH_STATUS", status: "listening" });
  };

  recognition.onresult = (event) => {
    let interimText = "";
    let finalText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      const isFinal = event.results[i].isFinal;

      if (isFinal) {
        finalText += transcript + " ";
      } else {
        interimText += transcript;
      }
    }

    if (interimText.trim()) {
      chrome.runtime.sendMessage({
        type: "NEW_TRANSCRIPTION",
        payload: {
          text: interimText.trim(),
          isFinal: false,
          timestamp: Date.now(),
        },
      });
    }

    if (finalText.trim()) {
      const chunk = {
        text: finalText.trim(),
        isFinal: true,
        timestamp: Date.now(),
      };

      sessionTranscript.push(chunk);

      chrome.runtime.sendMessage({
        type: "NEW_TRANSCRIPTION",
        payload: chunk,
      });

      // Persist to chrome.storage for summary generation
      persistTranscript(chunk);

      // ── Pause-Driven Chunking ──
      // Fire chunk processing immediately when the speaker finishes
      // a sentence (isFinal = true), instead of waiting for the 15s alarm.
      // The background script debounces rapid consecutive calls.
      chrome.runtime.sendMessage({
        type: "SEND_CHUNK_NOW",
        text: finalText.trim(),
      });
    }
  };

  recognition.onerror = (event) => {
    console.warn("[MeetSense] Speech recognition error:", event.error);

    switch (event.error) {
      case "no-speech":
        // Normal — silence detected, recognition will auto-restart via onend
        break;

      case "aborted":
        isListening = false;
        break;

      case "not-allowed":
        isListening = false;
        chrome.runtime.sendMessage({
          type: "SPEECH_STATUS",
          status: "mic-denied",
        });
        return;

      case "network":
        // Network errors are always transient — reset counter and always retry
        retryCount = 0;
        chrome.runtime.sendMessage({
          type: "SPEECH_STATUS",
          status: "error",
          error: "Network glitch — retrying transcription…",
        });
        setTimeout(() => startListening(), RETRY_DELAY_MS);
        return;

      default:
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(() => startListening(), RETRY_DELAY_MS);
        }
        chrome.runtime.sendMessage({
          type: "SPEECH_STATUS",
          status: "error",
          error: `Speech error: ${event.error} — retrying…`,
        });
        return;
    }
  };

  recognition.onend = () => {
    isListening = false;
    // Always restart — SpeechRecognition stops after silence or short sessions.
    // We keep it alive continuously for the full duration of the meeting.
    setTimeout(() => startListening(), 300);
  };
}

function startListening() {
  if (!recognition) return;
  if (isListening) return;

  try {
    recognition.start();
  } catch (e) {
    // "already started" — safe to ignore
    if (!e.message?.includes("already started")) {
      console.warn("[MeetSense] Start error:", e.message);
    }
  }
}

function stopListening() {
  if (!recognition) return;
  try {
    recognition.stop();
  } catch (_) {}
  isListening = false;
}

async function persistTranscript(chunk) {
  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];
  log.push(chunk);
  if (log.length > 2000) log.splice(0, log.length - 2000);
  await chrome.storage.local.set({ transcriptLog: log });
}

// ── Meet Page Readiness Detection ──
function waitForMeetLoad(retries = 30) {
  const loadIndicators = [
    "[data-call-ended]",
    "[data-allocation-index]",
    ".crqnQb",
    ".Tmb7Fd",
    '[jscontroller="LcYFW"]',
  ];

  const meetLoaded = loadIndicators.some((sel) =>
    document.querySelector(sel)
  );

  if (meetLoaded || retries <= 0) {
    console.log("[MeetSense] Meet UI detected. Starting transcription.");
    initSpeechRecognition();
    startListening();
    chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" });
  } else {
    setTimeout(() => waitForMeetLoad(retries - 1), 1000);
  }
}

// ── Message handler from background ──
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "START_TRANSCRIPTION":
      if (!recognition) initSpeechRecognition();
      startListening();
      break;

    case "STOP_TRANSCRIPTION":
      stopListening();
      break;

    case "CLEAR_TRANSCRIPT":
      sessionTranscript = [];
      chrome.storage.local.set({ transcriptLog: [] });
      break;
  }
});

// ── Boot ──
if (document.readyState === "complete") {
  waitForMeetLoad();
} else {
  window.addEventListener("load", waitForMeetLoad, { once: true });
}
