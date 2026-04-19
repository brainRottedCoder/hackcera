// ============================================================
// offscreen.js — Tab Audio Capture via MediaRecorder
//
// Runs in an offscreen document. Receives a tab-capture stream
// ID from the background service worker, creates a MediaRecorder,
// and sends audio chunks back as base64-encoded blobs.
// ============================================================

let mediaRecorder = null;
let audioStream = null;
let isRecording = false;
const CHUNK_INTERVAL_MS = 1000;

// Safe sendMessage — offscreen docs can also lose context
function safeSend(msg) {
  if (!chrome.runtime?.id) return;
  try { chrome.runtime.sendMessage(msg); } catch (_) {}
}

// BUG FIX: Register the message listener FIRST, THEN signal ready.
// Previously OFFSCREEN_READY was sent at the top level before the listener
// was set up, which caused a race where the background might receive the
// READY signal before the offscreen doc could receive START_TAB_CAPTURE.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START_TAB_CAPTURE") {
    startCapture(msg.streamId);
  }

  if (msg.type === "STOP_TAB_CAPTURE") {
    stopCapture();
  }
});

// Signal background that this offscreen doc is ready to receive messages.
// Sent AFTER the listener is registered so there's no ordering race.
safeSend({ type: "OFFSCREEN_READY" });

async function startCapture(streamId) {
  if (isRecording) {
    console.warn("[Offscreen] Already recording — ignoring START_TAB_CAPTURE.");
    return;
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType,
      audioBitsPerSecond: 32000,
    });

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size === 0) return;

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        safeSend({
          type: "AUDIO_CHUNK",
          payload: {
            audioBase64: base64,
            mimeType,
            timestamp: Date.now(),
          },
        });
      };
      reader.readAsDataURL(event.data);
    };

    mediaRecorder.onerror = (event) => {
      console.error("[Offscreen] MediaRecorder error:", event.error);
      safeSend({
        type: "TAB_CAPTURE_ERROR",
        error: event.error?.message || "MediaRecorder error",
      });
    };

    mediaRecorder.start(CHUNK_INTERVAL_MS);
    isRecording = true;

    console.log("[Offscreen] Tab audio capture started.");
    safeSend({ type: "TAB_CAPTURE_STARTED" });
  } catch (err) {
    console.error("[Offscreen] Failed to start capture:", err);
    safeSend({
      type: "TAB_CAPTURE_ERROR",
      error: err.message,
    });
  }
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
  isRecording = false;
  mediaRecorder = null;
  console.log("[Offscreen] Tab audio capture stopped.");
  safeSend({ type: "TAB_CAPTURE_STOPPED" });
}
