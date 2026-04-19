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
      const str = typeof raw === "string" ? raw : raw.toString();
      msg = JSON.parse(str);
    } catch {
      return;
    }

    // ── PING keepalive ──
    if (msg.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }

    // ── TRACK B: Real-time chunk processing (every 12s) ──
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
        ws.send(JSON.stringify({
          type: "INSIGHTS_ERROR",
          message: "AI processing failed. Please check your API key and quota."
        }));
        return;
      }

      if (result) {
        ctx.mergeFromLLM(result);

        ws.send(JSON.stringify({
          type: "INSIGHTS_UPDATE",
          payload: result
        }));
      } else {
        ws.send(JSON.stringify({
          type: "INSIGHTS_ERROR",
          message: "AI returned no result. API quota may be exhausted — check your Gemini API key."
        }));
      }
    }

    // ── TRACK C: Manual full-meeting summary ──
    if (msg.type === "GENERATE_SUMMARY") {
      console.log("\n[Summary] ═══════════════ SUMMARY REQUEST START ═══════════════");

      const { fullTranscript } = msg;

      // ── Step 1: validate transcript ──
      console.log(`[Summary] Step 1 — Transcript received. Length: ${fullTranscript?.length ?? 0} chars`);

      if (!fullTranscript || fullTranscript.trim().length < 50) {
        console.warn("[Summary] ❌ Transcript too short to summarize. Sending SUMMARY_ERROR.");
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: "Transcript too short to summarize."
        }));
        return;
      }

      // ── Step 2: build prompt ──
      const accTasks     = ctx.getAllTasks();
      const accDecisions = ctx.getAllDecisions();
      console.log(`[Summary] Step 2 — Context: ${accTasks.length} accumulated tasks, ${accDecisions.length} decisions`);

      let prompt;
      try {
        prompt = buildSummaryPrompt(fullTranscript, accTasks, accDecisions);
        console.log(`[Summary] Step 3 — Prompt built. Length: ${prompt.length} chars`);
        console.log(`[Summary] Prompt preview (first 300 chars):\n${prompt.slice(0, 300)}`);
      } catch (promptErr) {
        console.error("[Summary] ❌ buildSummaryPrompt threw an error:", promptErr);
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: `Prompt build failed: ${promptErr.message}`
        }));
        return;
      }

      // ── Step 4: call Gemini ──
      console.log("[Summary] Step 4 — Calling callGeminiSummary()...");
      let result;
      try {
        result = await callGeminiSummary(prompt);
      } catch (llmErr) {
        console.error("[Summary] ❌ callGeminiSummary threw an unexpected error:");
        console.error("[Summary]   Name   :", llmErr.name);
        console.error("[Summary]   Message:", llmErr.message);
        console.error("[Summary]   Stack  :", llmErr.stack);
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: `LLM call crashed: ${llmErr.message}`
        }));
        return;
      }

      // ── Step 5: handle result ──
      if (result) {
        console.log("[Summary] ✅ Step 5 — Result received:");
        console.log(`[Summary]   summary   : ${result.summary?.slice(0, 100)}`);
        console.log(`[Summary]   tasks     : ${result.tasks?.length ?? 0}`);
        console.log(`[Summary]   decisions : ${result.decisions?.length ?? 0}`);
        console.log(`[Summary]   risks     : ${result.risks?.length ?? 0}`);
        ws.send(JSON.stringify({ type: "SUMMARY_RESULT", payload: result }));
      } else {
        console.error("[Summary] ❌ Step 5 — callGeminiSummary returned null (all models failed).");
        console.error("[Summary]   Check logs above for [LLM] ❌ lines to see the specific API error.");
        ws.send(JSON.stringify({
          type: "SUMMARY_ERROR",
          message: "AI summary generation failed. Check server console for details."
        }));
      }

      console.log("[Summary] ═══════════════ SUMMARY REQUEST END ═══════════════\n");
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
