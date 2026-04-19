const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

class DeepgramManager {
  constructor(clientWs, onFinalChunk) {
    this.clientWs     = clientWs;
    this.onFinalChunk = onFinalChunk || null;
    this.live         = null;
    this.ready        = false;
    this.queue        = [];
    this.destroyed    = false;
    this.finalBuffer  = "";

    this._connect();
  }

  _connect() {
    if (!DEEPGRAM_API_KEY) {
      console.warn("[Deepgram] No API key set — tab audio STT disabled.");
      return;
    }

    const deepgram = createClient(DEEPGRAM_API_KEY);

    this.live = deepgram.listen.live({
      model:           "nova-3",
      language:        "en-US",
      smart_format:    true,
      interim_results: true,
      encoding:        "webm_opus",
      sample_rate:     48000,
      channels:        1,
    });

    this.live.on(LiveTranscriptionEvents.Open, () => {
      console.log("[Deepgram] Live connection open.");
      this.ready = true;
      if (this.queue.length > 0) {
        console.log("[Deepgram] Flushing " + this.queue.length + " queued chunks.");
        this.queue.forEach((buf) => {
          try { this.live.send(buf); } catch (_) {}
        });
        this.queue = [];
      }
    });

    this.live.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data && data.channel && data.channel.alternatives && data.channel.alternatives[0];
      if (!alt || !alt.transcript) return;

      const text    = alt.transcript.trim();
      const isFinal = data.is_final;

      if (!text) return;

      console.log("[Deepgram] " + (isFinal ? "FINAL" : "interim") + ": " + text);

      this._sendToClient({
        type:    "TRANSCRIPTION_RESULT",
        payload: {
          text: text,
          isFinal: isFinal,
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

    this.live.on(LiveTranscriptionEvents.Error, (err) => {
      console.error("[Deepgram] Error:", err && err.message ? err.message : err);
    });

    this.live.on(LiveTranscriptionEvents.Close, () => {
      console.log("[Deepgram] Live connection closed.");
      this.ready = false;

      if (!this.destroyed) {
        console.log("[Deepgram] Reconnecting in 2s...");
        setTimeout(() => this._connect(), 2000);
      }
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
      this.clientWs.send(JSON.stringify(msg));
    }
  }
}

module.exports = DeepgramManager;
