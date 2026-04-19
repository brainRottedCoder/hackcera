// ============================================================
// deepgramManager.js — Live Streaming STT via Deepgram
//
// One DeepgramManager instance per connected WebSocket session.
// Receives raw base64-encoded audio blobs from the offscreen doc
// (via the Chrome extension's tab capture), streams them to
// Deepgram's Nova-2 live transcription API, and emits the
// resulting transcript lines back through the client WS socket.
//
// Usage:
//   const dg = new DeepgramManager(clientWs);
//   dg.sendAudio(base64String, mimeType);  // per AUDIO_CHUNK
//   dg.destroy();                           // on session end
// ============================================================

const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

class DeepgramManager {
  constructor(clientWs) {
    this.clientWs  = clientWs;   // The browser-facing WebSocket
    this.live       = null;       // Deepgram live connection
    this.ready      = false;      // true once Deepgram socket is open
    this.queue      = [];         // buffer audio before DG is ready
    this.destroyed  = false;

    this._connect();
  }

  // ── Open Deepgram live stream ──
  _connect() {
    if (!DEEPGRAM_API_KEY) {
      console.warn("[Deepgram] No API key set — tab audio STT disabled.");
      return;
    }

    const deepgram = createClient(DEEPGRAM_API_KEY);

    this.live = deepgram.listen.live({
      model:           "nova-2",
      language:        "en-US",
      smart_format:    true,
      interim_results: true,
      encoding:        "webm-opus",   // matches offscreen.js MediaRecorder
      sample_rate:     48000,
      channels:        1,
    });

    this.live.on(LiveTranscriptionEvents.Open, () => {
      console.log("[Deepgram] Live connection open.");
      this.ready = true;
      // Flush any audio buffered before we were ready
      if (this.queue.length > 0) {
        console.log(`[Deepgram] Flushing ${this.queue.length} queued chunks.`);
        this.queue.forEach((buf) => this.live.send(buf));
        this.queue = [];
      }
    });

    this.live.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      const text    = alt.transcript.trim();
      const isFinal = data.is_final;

      if (!text) return;

      console.log(`[Deepgram] ${isFinal ? "FINAL" : "interim"}: ${text}`);

      // Send to the extension sidepanel
      this._sendToClient({
        type:    "TRANSCRIPTION_RESULT",
        payload: {
          text,
          isFinal,
          source:    "tab-audio",
          timestamp: Date.now(),
        },
      });

      // If it's a final result, also persist it by triggering chunk analysis
      if (isFinal && text.length > 15) {
        this._sendToClient({
          type: "DEEPGRAM_FINAL_CHUNK",
          text,
        });
      }
    });

    this.live.on(LiveTranscriptionEvents.Error, (err) => {
      console.error("[Deepgram] Error:", err?.message || err);
    });

    this.live.on(LiveTranscriptionEvents.Close, () => {
      console.log("[Deepgram] Live connection closed.");
      this.ready = false;

      // Auto-reconnect if session is still active
      if (!this.destroyed) {
        console.log("[Deepgram] Reconnecting in 2s…");
        setTimeout(() => this._connect(), 2000);
      }
    });
  }

  // ── Send base64 audio buffer to Deepgram ──
  sendAudio(audioBase64) {
    if (this.destroyed) return;

    let buffer;
    try {
      buffer = Buffer.from(audioBase64, "base64");
    } catch (e) {
      console.warn("[Deepgram] Failed to decode base64 audio:", e.message);
      return;
    }

    if (this.ready && this.live) {
      this.live.send(buffer);
    } else {
      // Queue until the socket is ready
      this.queue.push(buffer);
      if (this.queue.length > 50) {
        // Prevent unbounded growth — drop oldest
        this.queue.shift();
      }
    }
  }

  // ── Tear down gracefully ──
  destroy() {
    this.destroyed = true;
    this.ready     = false;
    this.queue     = [];
    if (this.live) {
      try { this.live.finish(); } catch (_) {}
      this.live = null;
    }
    console.log("[Deepgram] Manager destroyed.");
  }

  // ── Helper: safe send to client WS ──
  _sendToClient(msg) {
    if (this.clientWs?.readyState === 1 /* OPEN */) {
      this.clientWs.send(JSON.stringify(msg));
    }
  }
}

module.exports = DeepgramManager;
