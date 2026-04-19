// ============================================================
// server.js — Node.js WebSocket + Express Backend
//
// Handles two message types from extension:
//   "PROCESS_CHUNK"   → 12-second real-time insights (TRACK B)
//   "GENERATE_SUMMARY" → manual full-transcript summary (TRACK C)
// ============================================================

require("dotenv").config();
const express   = require("express");
const { WebSocketServer } = require("ws");
const http      = require("http");
const { callGeminiInsights, callGeminiSummary } = require("./llmOrchestrator");
const { buildInsightsPrompt, buildSummaryPrompt } = require("./promptBuilder");
const ContextManager = require("./contextManager");

const PORT = parseInt(process.env.PORT, 10) || 3001;

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.get("/health", (_, res) => res.json({ status: "ok" }));

// ── One ContextManager per connected WebSocket session ──
wss.on("connection", (ws) => {
  console.log("[Backend] New client connected.");
  const ctx = new ContextManager();

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed
    }

    // ── PING keepalive ──
    if (msg.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }

    // ── TRACK B: Real-time chunk processing (every 12s) ──
    if (msg.type === "PROCESS_CHUNK") {
      const { text } = msg;

      if (!text || text.trim().length < 20) return; // skip silence

      ctx.addChunk(text);

      const prompt = buildInsightsPrompt(
        ctx.getContext(),
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      const result = await callGeminiInsights(prompt);

      if (result) {
        ctx.mergeFromLLM(result);

        ws.send(JSON.stringify({
          type: "INSIGHTS_UPDATE",
          payload: result
        }));
      }
    }

    // ── TRACK C: Manual full-meeting summary ──
    if (msg.type === "GENERATE_SUMMARY") {
      const { fullTranscript } = msg;

      if (!fullTranscript || fullTranscript.trim().length < 50) {
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: "Transcript too short to summarize."
        }));
        return;
      }

      const prompt = buildSummaryPrompt(
        fullTranscript,
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      const result = await callGeminiSummary(prompt);

      if (result) {
        ws.send(JSON.stringify({
          type: "SUMMARY_RESULT",
          payload: result
        }));
      } else {
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: "AI summary generation failed. Please try again."
        }));
      }
    }
  });

  ws.on("close", () => {
    console.log("[Backend] Client disconnected. Context cleared.");
    ctx.reset();
  });

  ws.on("error", (err) => {
    console.error("[Backend] WS error:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[Backend] MeetSense server running on ws://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[Backend] ❌ Port ${PORT} is already in use.`);
    console.error(`[Backend] 👉 Kill it with:  npx kill-port ${PORT}`);
    console.error(`[Backend] 👉 Or change PORT in your .env file.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
