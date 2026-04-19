require("dotenv").config();
const express   = require("express");
const { WebSocketServer } = require("ws");
const http      = require("http");
const { callGeminiInsights, callGeminiSummary } = require("./llmOrchestrator");
const { buildInsightsPrompt, buildSummaryPrompt } = require("./promptBuilder");
const ContextManager  = require("./contextManager");
const DeepgramManager = require("./deepgramManager");

// ── Global error guards ──────────────────────────────────────
// Prevents a single async throw from crashing the whole server.
// nodemon shows "app crashed" when an unhandled rejection reaches
// the process — these handlers log it and keep the server alive.
process.on("unhandledRejection", (reason) => {
  console.error("[Backend] Unhandled promise rejection:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Backend] Uncaught exception:", err.message);
  // Do NOT exit — keep the server running for other clients
});

const PORT = parseInt(process.env.PORT, 10) || 3001;
const ENV  = process.env.NODE_ENV || "development";
const HAS_DEEPGRAM = !!process.env.DEEPGRAM_API_KEY;

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(function(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", function(_, res) {
  res.json({
    name:     "MeetSense AI Backend",
    status:   "ok",
    env:      ENV,
    deepgram: HAS_DEEPGRAM,
  });
});

app.get("/health", function(_, res) {
  res.json({
    status:   "ok",
    env:      ENV,
    deepgram: HAS_DEEPGRAM,
  });
});

wss.on("connection", function(ws, req) {
  var clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log("[Backend] New client connected from " + clientIp + ".");

  var ctx = new ContextManager();
  var dg  = null;

  if (HAS_DEEPGRAM) {
    dg = new DeepgramManager(ws, function onFinalChunk(text) {
      if (!text || text.trim().length < 20) return;

      ctx.addChunk(text);

      var prompt = buildInsightsPrompt(
        ctx.getContext(),
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      callGeminiInsights(prompt).then(function(result) {
        if (result) {
          ctx.mergeFromLLM(result);
          // BUG FIX: Guard readyState before send.
          // If the client disconnected while Deepgram was processing,
          // ws.send() throws an unhandled exception → nodemon crash.
          if (ws.readyState === ws.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "INSIGHTS_UPDATE", payload: result }));
            } catch (sendErr) {
              console.warn("[Backend/DG] ws.send failed:", sendErr.message);
            }
          }
        }
      }).catch(function(err) {
        console.error("[Backend/DG] LLM call threw:", err.message);
      });
    });
  } else {
    console.log("[Backend] DEEPGRAM_API_KEY not set — tab audio STT disabled.");
  }

  ws.on("message", async function(raw) {
    var msg;
    try {
      var str = typeof raw === "string" ? raw : raw.toString();
      msg = JSON.parse(str);
    } catch {
      return;
    }

    if (msg.type === "PING") {
      ws.send(JSON.stringify({ type: "PONG" }));
      return;
    }

    // TRACK B-audio: Tab audio -> Deepgram
    if (msg.type === "AUDIO_CHUNK") {
      if (!dg) return;
      var audioBase64 = msg.audioBase64;
      if (!audioBase64) return;
      dg.sendAudio(audioBase64);
      return;
    }

    // TRACK A: Real-time chunk processing (from Speech API)
    if (msg.type === "PROCESS_CHUNK") {
      var text = msg.text;

      if (!text || text.trim().length < 20) return;

      ctx.addChunk(text);

      var prompt = buildInsightsPrompt(
        ctx.getContext(),
        ctx.getAllTasks(),
        ctx.getAllDecisions()
      );

      var result;
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
          message: "AI returned no result. API quota may be exhausted.",
        }));
      }
    }

    // TRACK C: Manual full-meeting summary
    if (msg.type === "GENERATE_SUMMARY") {
      console.log("\n[Summary] ========== SUMMARY REQUEST START ==========");

      var fullTranscript = msg.fullTranscript;

      // Include accumulated Deepgram transcript
      var deepgramText = "";
      if (dg) {
        deepgramText = dg.getAccumulatedTranscript();
        if (deepgramText) {
          ctx.addChunk(deepgramText);
        }
      }

      var combinedTranscript = fullTranscript + (deepgramText ? " " + deepgramText : "");

      console.log("[Summary] Step 1 — Transcript length: " + (combinedTranscript ? combinedTranscript.length : 0) + " chars");

      if (!combinedTranscript || combinedTranscript.trim().length < 50) {
        console.warn("[Summary] Transcript too short.");
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "Transcript too short to summarize.",
        }));
        return;
      }

      var accTasks     = ctx.getAllTasks();
      var accDecisions = ctx.getAllDecisions();
      console.log("[Summary] Step 2 — Context: " + accTasks.length + " tasks, " + accDecisions.length + " decisions");

      var prompt;
      try {
        prompt = buildSummaryPrompt(combinedTranscript, accTasks, accDecisions);
        console.log("[Summary] Step 3 — Prompt built. Length: " + prompt.length + " chars");
      } catch (promptErr) {
        console.error("[Summary] buildSummaryPrompt threw:", promptErr);
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "Prompt build failed: " + promptErr.message,
        }));
        return;
      }

      console.log("[Summary] Step 4 — Calling callGeminiSummary()...");
      var result;
      try {
        result = await callGeminiSummary(prompt);
      } catch (llmErr) {
        console.error("[Summary] callGeminiSummary threw:", llmErr.message);
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "LLM call crashed: " + llmErr.message,
        }));
        return;
      }

      if (result) {
        console.log("[Summary] OK — tasks: " + (result.tasks ? result.tasks.length : 0) + ", decisions: " + (result.decisions ? result.decisions.length : 0));
        ws.send(JSON.stringify({ type: "SUMMARY_RESULT", payload: result }));
      } else {
        console.error("[Summary] All models failed.");
        ws.send(JSON.stringify({
          type:    "SUMMARY_ERROR",
          message: "AI summary generation failed. Check server console.",
        }));
      }

      console.log("[Summary] ========== SUMMARY REQUEST END ==========\n");
    }
  });

  ws.on("close", function() {
    console.log("[Backend] Client disconnected. Cleaning up.");
    ctx.reset();
    if (dg) dg.destroy();
  });

  ws.on("error", function(err) {
    console.error("[Backend] WS error:", err.message);
  });
});

server.listen(PORT, function() {
  console.log("\n[Backend] MeetSense AI server running");
  console.log("[Backend]   ENV      : " + ENV);
  console.log("[Backend]   PORT     : " + PORT);
  console.log("[Backend]   Deepgram : " + (HAS_DEEPGRAM ? "enabled" : "disabled (no key)"));
  console.log("[Backend]   Health   : http://localhost:" + PORT + "/health\n");
});

server.on("error", function(err) {
  if (err.code === "EADDRINUSE") {
    console.error("\n[Backend] Port " + PORT + " is already in use.");
    console.error("[Backend] Kill it with:  npx kill-port " + PORT);
    process.exit(1);
  } else {
    throw err;
  }
});
