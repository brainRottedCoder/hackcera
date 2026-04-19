const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// Maximum reconnect attempts before giving up (prevents infinite loops)
const MAX_RECONNECTS = 5;

class DeepgramManager {
  constructor(clientWs, onFinalChunk) {
    this.clientWs     = clientWs;
    this.onFinalChunk = onFinalChunk || null;
    this.live         = null;
    this.ready        = false;
    this.queue        = [];
    this.destroyed    = false;
    this.finalBuffer  = "";
    this.reconnectCount  = 0;
    this.reconnectDelay  = 2000; // starts at 2s, doubles each attempt

    this._connect();
  }

  _connect() {
    if (this.destroyed) return;

    if (!DEEPGRAM_API_KEY) {
      console.warn("[Deepgram] No API key set — tab audio STT disabled.");
      return;
    }

    // BUG FIX: Close existing connection before creating a new one.
    // Without this, every reconnect leaks the previous WebSocket.
    if (this.live) {
      try { this.live.finish(); } catch (_) {}
      this.live = null;
    }

    const deepgram = createClient(DEEPGRAM_API_KEY);

    // BUG FIX: encoding must be "opus" not "webm_opus".
    // Deepgram's streaming API rejects "webm_opus" and immediately closes
    // the connection — causing the infinite reconnect loop in the logs.
    // BUG FIX: Use nova-2 (stable streaming) instead of nova-3.
    // nova-3 has stricter encoding/format requirements for live streaming.
    this.live = deepgram.listen.live({
      model:           "nova-2",
      language:        "en-US",
      smart_format:    true,
      interim_results: true,
      encoding:        "opus",        // ← was "webm_opus" which is INVALID
      sample_rate:     48000,
      channels:        1,
      endpointing:     300,           // ms of silence = end of utterance
    });

    this.live.on(LiveTranscriptionEvents.Open, () => {
      console.log("[Deepgram] Live connection open.");
      this.ready = true;
      this.reconnectCount = 0;       // reset on successful open
      this.reconnectDelay = 2000;    // reset backoff on success

      if (this.queue.length > 0) {
        console.log("[Deepgram] Flushing " + this.queue.length + " queued chunks.");
        this.queue.forEach((buf) => {
          try { this.live.send(buf); } catch (_) {}
        });
        this.queue = [];
      }
    });

    this.live.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      const text    = alt.transcript.trim();
      const isFinal = data.is_final;

      if (!text) return;

      console.log("[Deepgram] " + (isFinal ? "FINAL" : "interim") + ": " + text);

      this._sendToClient({
        type:    "TRANSCRIPTION_RESULT",
        payload: {
          text,
          isFinal,
          source:    "tab-audio",
          timestamp: Date.now(),
        },
      });

      if (isFinal && text.length > 15) {
        this.finalBuffer += text + " ";
        if (this.onFinalChunk) {
          this.onFinalChunk(text);
        }
      }
    });

    // BUG FIX: Log actual error message string, not the raw ErrorEvent object.
    // The old code logged `err` directly which printed "ErrorEvent { ... }"
    // with no useful information about what actually went wrong.
    this.live.on(LiveTranscriptionEvents.Error, (err) => {
      const msg = err?.message || err?.type || JSON.stringify(err);
      console.error("[Deepgram] Connection error:", msg);
    });

    this.live.on(LiveTranscriptionEvents.Close, (code) => {
      console.log("[Deepgram] Live connection closed. Code:", code ?? "unknown");
      this.ready = false;

      if (this.destroyed) return;

      // BUG FIX: Exponential backoff with a hard max retry limit.
      // The old code retried every 2s forever — hammering Deepgram's API.
      if (this.reconnectCount >= MAX_RECONNECTS) {
        console.error(
          "[Deepgram] Max reconnects (" + MAX_RECONNECTS + ") reached. Giving up. " +
          "Check DEEPGRAM_API_KEY and audio encoding settings."
        );
        return;
      }

      this.reconnectCount++;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // cap at 30s

      console.log(
        "[Deepgram] Reconnecting in " + delay + "ms " +
        "(attempt " + this.reconnectCount + "/" + MAX_RECONNECTS + ")..."
      );
      setTimeout(() => this._connect(), delay);
    });
  }

  sendAudio(audioBase64) {
    if (this.destroyed) return;

    var buffer;
    try {
      buffer = Buffer.from(audioBase64, "base64");
    } catch (e) {
      console.warn("[Deepgram] Failed to decode base64 audio:", e.message);
      return;
    }

    if (this.ready && this.live) {
      try {
        this.live.send(buffer);
      } catch (err) {
        console.warn("[Deepgram] Send error:", err.message);
        this.queue.push(buffer);
      }
    } else {
      // Buffer while reconnecting, cap at 50 chunks (~50s of audio)
      this.queue.push(buffer);
      if (this.queue.length > 50) {
        this.queue.shift();
      }
    }
  }

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

  getAccumulatedTranscript() {
    return this.finalBuffer.trim();
  }

  _sendToClient(msg) {
    if (this.clientWs && this.clientWs.readyState === 1) {
      try {
        this.clientWs.send(JSON.stringify(msg));
      } catch (_) {}
    }
  }
}

module.exports = DeepgramManager;
