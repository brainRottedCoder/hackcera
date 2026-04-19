// ============================================================
// offscreen.js — Tab Audio Capture via MediaRecorder
//
// Runs in an offscreen document. Receives a tab-capture stream
// ID from the background service worker, creates a MediaRecorder,
// and sends audio chunks back as base64-encoded blobs.
//
// Chunks are sent every 1 second (vs 8s previously) because
// Deepgram streaming STT benefits from smaller, more frequent
// chunks for lower latency transcription.
// ============================================================

let mediaRecorder = null;
let audioStream = null;
let isRecording = false;
const CHUNK_INTERVAL_MS = 1000;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START_TAB_CAPTURE") {
    startCapture(msg.streamId);
  }

  if (msg.type === "STOP_TAB_CAPTURE") {
    stopCapture();
  }
});

chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" });

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
        chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
        type: "TAB_CAPTURE_ERROR",
        error: event.error?.message || "MediaRecorder error",
      });
    };

    mediaRecorder.start(CHUNK_INTERVAL_MS);
    isRecording = true;

    console.log("[Offscreen] Tab audio capture started (1s chunks for Deepgram streaming).");
    chrome.runtime.sendMessage({ type: "TAB_CAPTURE_STARTED" });
  } catch (err) {
    console.error("[Offscreen] Failed to start capture:", err);
    chrome.runtime.sendMessage({
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
  chrome.runtime.sendMessage({ type: "TAB_CAPTURE_STOPPED" });
}
