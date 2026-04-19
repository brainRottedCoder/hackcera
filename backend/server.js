// ============================================================
// server.js — Node.js WebSocket + Express Backend (v2)
//
// Handles three input sources:
//   PROCESS_CHUNK   — final transcription text from Speech API
//   AUDIO_CHUNK     — base64 audio from tab capture → Whisper STT
//   GENERATE_SUMMARY — manual full-transcript summary
//
// All sources feed into the same LLM insights pipeline.
// ============================================================

require("dotenv").config();
const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const {
  callGeminiInsights,
  callGeminiSummary,
} = require("./llmOrchestrator");
const {
  buildInsightsPrompt,
  buildSummaryPrompt,
} = require("./promptBuilder");
const ContextManager = require("./contextManager");
const transcriber = require("./transcriber");

const PORT = parseInt(process.env.PORT, 10) || 3001;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/health", (_, res) =>
  res.json({
    status: "ok",
    whisper: transcriber.isConfigured() ? "configured" : "not_configured",
  })
);

wss.on("connection", (ws) => {
  console.log("[Backend] New client connected.");
  const ctx = new ContextManager();

  ws.on("message", async (raw) => {
    let msg;
    try {
      const str = typeof raw === "string" ? raw : raw.toString();
      msg = JSON.parse(str);
    } catch {
      return;
    }

    if (msg.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }

    // ── PROCESS_CHUNK: Speech API transcription text ──
    if (msg.type === "PROCESS_CHUNK") {
      const { text } = msg;
      if (!text || text.trim().length < 20) return;

      ctx.addChunk(text);

      const prompt = buildInsightsPrompt(
        ctx.getContext(),
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      let result;
      try {
        result = await callGeminiInsights(prompt);
      } catch (err) {
        console.error("[Backend] LLM call threw:", err.message);
        ws.send(
          JSON.stringify({
            type: "INSIGHTS_ERROR",
            message: "AI processing failed. Please check your API key and quota.",
          })
        );
        return;
      }

      if (result) {
        ctx.mergeFromLLM(result);
        ws.send(JSON.stringify({ type: "INSIGHTS_UPDATE", payload: result }));
      } else {
        ws.send(
          JSON.stringify({
            type: "INSIGHTS_ERROR",
            message: "AI returned no result. API quota may be exhausted.",
          })
        );
      }
    }

    // ── AUDIO_CHUNK: Tab-captured audio → Whisper STT ──
    if (msg.type === "AUDIO_CHUNK") {
      const { audioBase64, mimeType } = msg;

      if (!audioBase64) return;

      if (!transcriber.isConfigured()) {
        return;
      }

      transcriber.addAudioChunk(audioBase64, mimeType);
    }

    // ── GENERATE_SUMMARY: Manual full-meeting summary ──
    if (msg.type === "GENERATE_SUMMARY") {
      console.log(
        "\n[Summary] ═══════════════ SUMMARY REQUEST START ═══════════════"
      );

      const { fullTranscript } = msg;

      // Flush any remaining audio buffer first
      let whisperText = null;
      if (transcriber.isConfigured()) {
        whisperText = await transcriber.flushAndTranscribe();
        if (whisperText) {
          ctx.addChunk(whisperText);
        }
      }

      const combinedTranscript = fullTranscript + (whisperText ? " " + whisperText : "");

      console.log(
        `[Summary] Step 1 — Transcript received. Length: ${combinedTranscript?.length ?? 0} chars`
      );

      if (
        !combinedTranscript ||
        combinedTranscript.trim().length < 50
      ) {
        console.warn(
          "[Summary] ❌ Transcript too short to summarize."
        );
        ws.send(
          JSON.stringify({
            type: "SUMMARY_ERROR",
            message: "Transcript too short to summarize.",
          })
        );
        return;
      }

      const accTasks = ctx.getAllTasks();
      const accDecisions = ctx.getAllDecisions();
      console.log(
        `[Summary] Step 2 — Context: ${accTasks.length} tasks, ${accDecisions.length} decisions`
      );

      let prompt;
      try {
        prompt = buildSummaryPrompt(
          combinedTranscript,
          accTasks,
          accDecisions
        );
        console.log(
          `[Summary] Step 3 — Prompt built. Length: ${prompt.length} chars`
        );
      } catch (promptErr) {
        console.error(
          "[Summary] ❌ buildSummaryPrompt threw:",
          promptErr
        );
        ws.send(
          JSON.stringify({
            type: "SUMMARY_ERROR",
            message: `Prompt build failed: ${promptErr.message}`,
          })
        );
        return;
      }

      console.log("[Summary] Step 4 — Calling callGeminiSummary()…");
      let result;
      try {
        result = await callGeminiSummary(prompt);
      } catch (llmErr) {
        console.error("[Summary] ❌ callGeminiSummary error:", llmErr.message);
        ws.send(
          JSON.stringify({
            type: "SUMMARY_ERROR",
            message: `LLM call crashed: ${llmErr.message}`,
          })
        );
        return;
      }

      if (result) {
        console.log("[Summary] ✅ Result received.");
        ws.send(
          JSON.stringify({ type: "SUMMARY_RESULT", payload: result })
        );
      } else {
        console.error(
          "[Summary] ❌ callGeminiSummary returned null."
        );
        ws.send(
          JSON.stringify({
            type: "SUMMARY_ERROR",
            message: "AI summary generation failed. Check server logs.",
          })
        );
      }

      console.log(
        "[Summary] ═══════════════ SUMMARY REQUEST END ═══════════════\n"
      );
    }
  });

  ws.on("close", () => {
    console.log("[Backend] Client disconnected. Context cleared.");
    ctx.reset();
    transcriber.reset();
  });

  ws.on("error", (err) => {
    console.error("[Backend] WS error:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(
    `[Backend] MeetSense server running on ws://localhost:${PORT}`
  );
  if (transcriber.isConfigured()) {
    console.log("[Backend] Whisper STT: ✅ configured");
  } else {
    console.log(
      "[Backend] Whisper STT: ⚠️ not configured (set OPENAI_API_KEY in .env for tab-capture transcription)"
    );
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[Backend] ❌ Port ${PORT} is already in use.`);
    console.error(
      `[Backend] 👉 Kill it with:  npx kill-port ${PORT}`
    );
    process.exit(1);
  } else {
    throw err;
  }
});
