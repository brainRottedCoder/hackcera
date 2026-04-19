// ============================================================
// transcriber.js — Deepgram Streaming STT
//
// Opens a real-time WebSocket connection to Deepgram's Nova-3
// model. Audio chunks from the extension are streamed directly
// — no batching, no waiting. Transcription results arrive
// within ~300ms via Deepgram's WebSocket.
//
// Falls back gracefully if DEEPGRAM_API_KEY is not configured
// (tab-capture transcription simply won't be available).
//
// Each client WS connection gets its own Deepgram live session.
// ============================================================

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

function isConfigured() {
  return !!DEEPGRAM_API_KEY;
}

class DeepgramStream {
  constructor(onTranscript) {
    this.onTranscript = onTranscript;
    this.dg = null;
    this.connection = null;
    this.isConnected = false;
    this.pendingAudio = [];
    this.finalBuffer = "";
  }

  async start() {
    if (!isConfigured()) {
      console.warn(
        "[Deepgram] DEEPGRAM_API_KEY not set — streaming STT disabled."
      );
      return;
    }

    try {
      const { createClient } = require("@deepgram/sdk");
      this.dg = createClient(DEEPGRAM_API_KEY);

      this.connection = this.dg.listen.live({
        model: "nova-3",
        language: "en-US",
        punctuate: true,
        interim_results: true,
        smart_format: true,
        endpointing: 500,
        utterance_end_ms: 1000,
      });

      this.connection.on("open", () => {
        this.isConnected = true;
        console.log("[Deepgram] ✅ Streaming connection opened.");

        if (this.pendingAudio.length > 0) {
          console.log(
            `[Deepgram] Flushing ${this.pendingAudio.length} pending audio chunks.`
          );
          this.pendingAudio.forEach((buf) => {
            try {
              this.connection.send(buf);
            } catch (_) {}
          });
          this.pendingAudio = [];
        }
      });

      this.connection.on("transcript", (data) => {
        const alternative = data?.channel?.alternatives?.[0];
        if (!alternative) return;

        const transcript = alternative.transcript;
        const isFinal = data.is_final;

        if (!transcript || transcript.trim().length === 0) return;

        if (isFinal) {
          this.finalBuffer += transcript.trim() + " ";

          console.log(
            `[Deepgram] Final: "${transcript.trim().slice(0, 100)}"`
          );

          this.onTranscript({
            text: transcript.trim(),
            isFinal: true,
            timestamp: Date.now(),
          });
        } else {
          this.onTranscript({
            text: transcript.trim(),
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      });

      this.connection.on("close", (code, reason) => {
        this.isConnected = false;
        console.log(
          `[Deepgram] Connection closed (code=${code}, reason=${reason || "none"}).`
        );

        if (this.finalBuffer.trim().length > 0) {
          console.log(
            `[Deepgram] Session ended. Total final transcript length: ${this.finalBuffer.trim().length} chars.`
          );
        }
      });

      this.connection.on("error", (err) => {
        console.error("[Deepgram] ❌ Error:", err?.message || err);
        this.isConnected = false;
      });
    } catch (err) {
      console.error("[Deepgram] Failed to start:", err.message);
    }
  }

  sendAudio(base64Data) {
    if (!this.connection) {
      return;
    }

    const buffer = Buffer.from(base64Data, "base64");

    if (this.isConnected) {
      try {
        this.connection.send(buffer);
      } catch (err) {
        console.warn("[Deepgram] Send error:", err.message);
      }
    } else {
      this.pendingAudio.push(buffer);
      if (this.pendingAudio.length > 50) {
        this.pendingAudio.shift();
      }
    }
  }

  stop() {
    if (this.connection) {
      try {
        if (this.isConnected) {
          this.connection.finish();
        }
      } catch (_) {}
      this.connection = null;
      this.isConnected = false;
    }
    this.pendingAudio = [];
  }

  getAccumulatedTranscript() {
    return this.finalBuffer.trim();
  }
}

module.exports = {
  isConfigured,
  DeepgramStream,
};
