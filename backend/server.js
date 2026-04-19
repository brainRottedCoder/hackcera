// ============================================================
// server.js — Node.js WebSocket + Express Backend
//
// Handles three message types from extension:
//   "PROCESS_CHUNK"    → real-time insights (TRACK B)
//   "GENERATE_SUMMARY" → full meeting summary (TRACK C)
//   "AUDIO_CHUNK"      → tab audio → Deepgram live STT (TRACK B-audio)
//
// Deployment-ready:
//   - Dynamic PORT (Railway/Render inject $PORT automatically)
//   - CORS headers on HTTP routes
//   - /health endpoint for deployment platform health checks
//   - Graceful WebSocket upgrade handling
// ============================================================

require("dotenv").config();
const express   = require("express");
const { WebSocketServer } = require("ws");
const http      = require("http");
const { callGeminiInsights, callGeminiSummary } = require("./llmOrchestrator");
const { buildInsightsPrompt, buildSummaryPrompt } = require("./promptBuilder");
const ContextManager  = require("./contextManager");
const DeepgramManager = require("./deepgramManager");

const PORT = parseInt(process.env.PORT, 10) || 3001;
const ENV  = process.env.NODE_ENV || "development";
const HAS_DEEPGRAM = !!process.env.DEEPGRAM_API_KEY;

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── CORS middleware for HTTP routes ──
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Health Check ──
app.get("/", (_, res) => res.json({
  name:     "MeetSense AI Backend",
  status:   "ok",
  env:      ENV,
  deepgram: HAS_DEEPGRAM,
}));

app.get("/health", (_, res) => res.json({
  status:   "ok",
  env:      ENV,
  deepgram: HAS_DEEPGRAM,
}));

// ── One ContextManager + DeepgramManager per WebSocket session ──
wss.on("connection", (ws, req) => {
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`[Backend] New client connected from ${clientIp}.`);

  const ctx = new ContextManager();
  const dg  = HAS_DEEPGRAM ? new DeepgramManager(ws) : null;

  if (!HAS_DEEPGRAM) {
    console.log("[Backend] DEEPGRAM_API_KEY not set — tab audio STT disabled.");
  }

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

    // ── TRACK B-audio: Tab audio → Deepgram ──
    if (msg.type === "AUDIO_CHUNK") {
      if (!dg) return; // Deepgram not configured — silently skip
      const { audioBase64 } = msg;
      if (!audioBase64) return;
      dg.sendAudio(audioBase64);
      return;
    }

    // ── TRACK B-audio: Deepgram final chunk → insights pipeline ──
    // When Deepgram emits a final transcript, the DeepgramManager
    // broadcasts DEEPGRAM_FINAL_CHUNK which we intercept server-side
    // to feed into the same insights pipeline as Track A.
    // NOTE: DeepgramManager sends TRANSCRIPTION_RESULT directly to
    // the client WS, so we only need to handle the insights trigger here.
    if (msg.type === "DEEPGRAM_FINAL_CHUNK") {
      const { text } = msg;
      if (!text || text.trim().length < 20) return;

      ctx.addChunk(text);

      const prompt = buildInsightsPrompt(
        ctx.getContext(),
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      const result = await callGeminiInsights(prompt).catch((err) => {
        console.error("[Backend/DG] LLM call threw:", err.message);
        return null;
      });

      if (result) {
        ctx.mergeFromLLM(result);
        ws.send(JSON.stringify({ type: "INSIGHTS_UPDATE", payload: result }));
      }
      return;
    }

    // ── TRACK B: Real-time chunk processing (every 15s alarm) ──
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
          type:    "INSIGHTS_ERROR",
          message: "AI processing failed. Please check your API key and quota.",
        }));
        return;
      }

      if (result) {
        ctx.mergeFromLLM(result);
        ws.send(JSON.stringify({ type: "INSIGHTS_UPDATE", payload: result }));
      } else {
        ws.send(JSON.stringify({
          type:    "INSIGHTS_ERROR",
          message: "AI returned no result. API quota may be exhausted — check your Gemini API key.",
        }));
      }
    }

    // ── TRACK C: Manual full-meeting summary ──
    if (msg.type === "GENERATE_SUMMARY") {
      console.log("\n[Summary] ═══════════════ SUMMARY REQUEST START ═══════════════");

      const { fullTranscript } = msg;

      console.log(`[Summary] Step 1 — Transcript received. Length: ${fullTranscript?.length ?? 0} chars`);

      if (!fullTranscript || fullTranscript.trim().length < 50) {
        console.warn("[Summary] ❌ Transcript too short. Sending SUMMARY_ERROR.");
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "Transcript too short to summarize.",
        }));
        return;
      }

      const accTasks     = ctx.getAllTasks();
      const accDecisions = ctx.getAllDecisions();
      console.log(`[Summary] Step 2 — Context: ${accTasks.length} accumulated tasks, ${accDecisions.length} decisions`);

      let prompt;
      try {
        prompt = buildSummaryPrompt(fullTranscript, accTasks, accDecisions);
        console.log(`[Summary] Step 3 — Prompt built. Length: ${prompt.length} chars`);
      } catch (promptErr) {
        console.error("[Summary] ❌ buildSummaryPrompt threw:", promptErr);
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: `Prompt build failed: ${promptErr.message}`,
        }));
        return;
      }

      console.log("[Summary] Step 4 — Calling callGeminiSummary()...");
      let result;
      try {
        result = await callGeminiSummary(prompt);
      } catch (llmErr) {
        console.error("[Summary] ❌ callGeminiSummary threw:", llmErr.message);
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: `LLM call crashed: ${llmErr.message}`,
        }));
        return;
      }

      if (result) {
        console.log(`[Summary] ✅ Step 5 — tasks: ${result.tasks?.length}, decisions: ${result.decisions?.length}, risks: ${result.risks?.length}`);
        ws.send(JSON.stringify({ type: "SUMMARY_RESULT", payload: result }));
      } else {
        console.error("[Summary] ❌ All models failed.");
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "AI summary generation failed. Check server console for details.",
        }));
      }

      console.log("[Summary] ═══════════════ SUMMARY REQUEST END ═══════════════\n");
    }
  });

  ws.on("close", () => {
    console.log("[Backend] Client disconnected. Cleaning up.");
    ctx.reset();
    if (dg) dg.destroy();
  });

  ws.on("error", (err) => {
    console.error("[Backend] WS error:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(`\n[Backend] MeetSense AI server running`);
  console.log(`[Backend]   ENV      : ${ENV}`);
  console.log(`[Backend]   PORT     : ${PORT}`);
  console.log(`[Backend]   Deepgram : ${HAS_DEEPGRAM ? "✅ enabled" : "⚠️  disabled (no key)"}`);
  console.log(`[Backend]   Health   : http://localhost:${PORT}/health\n`);
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
