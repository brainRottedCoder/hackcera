// ============================================================
// transcriber.js — Whisper API Transcription
//
// Receives audio buffers (base64-encoded webm/opus) from
// the extension's offscreen document via the WebSocket server.
// Accumulates them and periodically sends to OpenAI Whisper
// for transcription. Returns the text result.
//
// Falls back gracefully if OPENAI_API_KEY is not configured
// (tab-capture transcription simply won't be available).
// ============================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const ACCUMULATE_MS = 15000;
const MAX_AUDIO_BUFFER_BYTES = 5 * 1024 * 1024;

let audioBuffers = [];
let bufferStartTime = null;
let transcribeTimer = null;

function isConfigured() {
  return !!OPENAI_API_KEY;
}

function addAudioChunk(base64Data, mimeType) {
  const buffer = Buffer.from(base64Data, "base64");
  audioBuffers.push({ buffer, mimeType: mimeType || "audio/webm" });

  if (!bufferStartTime) bufferStartTime = Date.now();

  if (buffer.byteLength > MAX_AUDIO_BUFFER_BYTES) {
    audioBuffers.shift();
  }

  if (!transcribeTimer) {
    transcribeTimer = setTimeout(() => {
      flushAndTranscribe();
    }, ACCUMULATE_MS);
  }
}

async function flushAndTranscribe() {
  transcribeTimer = null;

  if (audioBuffers.length === 0) return null;

  if (!isConfigured()) {
    console.warn(
      "[Transcriber] OPENAI_API_KEY not set — skipping Whisper transcription."
    );
    audioBuffers = [];
    bufferStartTime = null;
    return null;
  }

  const chunks = [...audioBuffers];
  audioBuffers = [];
  bufferStartTime = null;

  try {
    const combinedBuffer = Buffer.concat(chunks.map((c) => c.buffer));

    const ext = chunks[0]?.mimeType?.includes("webm") ? "webm" : "ogg";
    const filename = `meeting_audio.${ext}`;

    const formData = new FormData();
    formData.append("file", new Blob([combinedBuffer], { type: chunks[0]?.mimeType }), filename);
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");
    formData.append("language", "en");

    const response = await fetch(WHISPER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        `[Transcriber] Whisper API error ${response.status}: ${errText}`
      );
      return null;
    }

    const transcription = await response.text();
    console.log(
      `[Transcriber] Whisper result (${transcription.length} chars): ${transcription.slice(0, 200)}`
    );

    if (transcription.trim().length < 5) return null;

    return transcription.trim();
  } catch (err) {
    console.error("[Transcriber] Transcription failed:", err.message);
    return null;
  }
}

function reset() {
  audioBuffers = [];
  bufferStartTime = null;
  if (transcribeTimer) {
    clearTimeout(transcribeTimer);
    transcribeTimer = null;
  }
}

module.exports = {
  isConfigured,
  addAudioChunk,
  flushAndTranscribe,
  reset,
};
