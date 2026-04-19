// ============================================================
// test.js — MeetSense AI Integration Test Suite
//
// Tests:
//   1. HTTP health check endpoint
//   2. WebSocket connection
//   3. PROCESS_CHUNK (TRACK B) → Gemini insights
//   4. GENERATE_SUMMARY (TRACK C) → Gemini summary
//   5. PING/PONG keepalive
//   6. Empty/silence guard (should NOT trigger LLM)
// ============================================================

const WebSocket = require("ws");

const WS_URL    = "ws://localhost:3001";
const HTTP_URL  = "http://localhost:3001/health";

// ── Terminal colors ──
const G  = (s) => `\x1b[32m${s}\x1b[0m`; // green
const R  = (s) => `\x1b[31m${s}\x1b[0m`; // red
const Y  = (s) => `\x1b[33m${s}\x1b[0m`; // yellow
const B  = (s) => `\x1b[36m${s}\x1b[0m`; // blue/cyan
const BO = (s) => `\x1b[1m${s}\x1b[0m`;  // bold

let passed = 0;
let failed = 0;

function ok(label)   { console.log(G(`  ✅ PASS`) + ` — ${label}`); passed++; }
function fail(label, err) { console.log(R(`  ❌ FAIL`) + ` — ${label}: ${err}`); failed++; }
function info(msg)   { console.log(B(`  ℹ  ${msg}`)); }

// ── 1. HTTP Health Check ──
async function testHealth() {
  console.log(BO("\n📡 Test 1: HTTP Health Check"));
  try {
    const res  = await fetch(HTTP_URL);
    const body = await res.json();
    if (res.status === 200 && body.status === "ok") {
      ok(`GET /health → 200 OK`);
    } else {
      fail("Health check", `unexpected response: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail("Health check", e.message);
  }
}

// ── 2–6. WebSocket Tests ──
function testWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const results = {};
    let testQueue = [];

    ws.on("open", () => {
      ok("WebSocket connected to ws://localhost:3001");

      // ── Test 3: PING / PONG ──
      console.log(BO("\n🏓 Test 2: PING / PONG Keepalive"));
      ws.send(JSON.stringify({ type: "PING" }));

      // ── Test 4: Silence guard (< 20 chars → should NOT trigger LLM) ──
      testQueue.push(() => {
        console.log(BO("\n🔇 Test 3: Silence Guard (should be silently ignored)"));
        ws.send(JSON.stringify({ type: "PROCESS_CHUNK", text: "ok.", timestamp: Date.now() }));
        // No response expected — wait 2s and move on
        setTimeout(() => {
          ok("Silence guard: no LLM call triggered for short text");
          runNext();
        }, 2000);
      });

      // ── Test 5: PROCESS_CHUNK — real-time insights ──
      testQueue.push(() => {
        console.log(BO("\n⚡ Test 4: PROCESS_CHUNK → Gemini Insights (TRACK B)"));
        info("Sending realistic meeting transcript chunk…");

        ws.send(JSON.stringify({
          type: "PROCESS_CHUNK",
          text: "Rahul will deploy the new API to production by tomorrow evening. We have decided to launch on Friday. " +
                "Sarah will write the test cases by Thursday. The authentication module is incomplete which could be a risk.",
          timestamp: Date.now()
        }));

        const timeout = setTimeout(() => {
          fail("PROCESS_CHUNK", "No response from Gemini in 20s");
          runNext();
        }, 20000);

        results["chunks"] = { timeout };
      });

      // ── Test 6: GENERATE_SUMMARY — full summary ──
      testQueue.push(() => {
        console.log(BO("\n📋 Test 5: GENERATE_SUMMARY → Gemini Summary (TRACK C)"));
        info("Sending full transcript for summary…");

        ws.send(JSON.stringify({
          type: "GENERATE_SUMMARY",
          fullTranscript:
            "Welcome everyone. Today we are discussing the product launch. " +
            "Rahul will handle the backend deployment by Friday. " +
            "Sarah mentioned that the UI tests are not complete yet, which is a risk. " +
            "We have decided to postpone the public announcement to next Monday. " +
            "John will send the client a status update by end of day today. " +
            "There may be a database scaling issue if traffic exceeds 10,000 users.",
          timestamp: Date.now()
        }));

        const timeout = setTimeout(() => {
          fail("GENERATE_SUMMARY", "No response from Gemini in 30s");
          runNext();
        }, 30000);

        results["summary"] = { timeout };
      });

      // ── Test 7: Empty transcript guard ──
      testQueue.push(() => {
        console.log(BO("\n🚫 Test 6: Empty Transcript Guard"));
        ws.send(JSON.stringify({ type: "GENERATE_SUMMARY", fullTranscript: "", timestamp: Date.now() }));
        // Expect SUMMARY_ERROR back
        const timeout = setTimeout(() => {
          fail("Empty transcript guard", "No SUMMARY_ERROR returned in 5s");
          runNext();
        }, 5000);
        results["emptyGuard"] = { timeout };
      });

      // Start first queued test
      runNext();
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // PONG
      if (msg.type === "PONG") {
        ok("PING → PONG received");
        runNext();
        return;
      }

      // INSIGHTS_UPDATE
      if (msg.type === "INSIGHTS_UPDATE") {
        clearTimeout(results["chunks"]?.timeout);
        const p = msg.payload;
        info(`Gemini returned: tasks=${p.tasks?.length || 0}, decisions=${p.decisions?.length || 0}, risks=${p.risks?.length || 0}`);

        if (Array.isArray(p.tasks) && Array.isArray(p.decisions) && Array.isArray(p.risks)) {
          ok("PROCESS_CHUNK → valid structured JSON received");
          if (p.tasks.length > 0) {
            info(`  Sample task: "${p.tasks[0].task}" | owner: ${p.tasks[0].owner} | deadline: ${p.tasks[0].deadline}`);
          }
          if (p.decisions.length > 0) info(`  Sample decision: "${p.decisions[0]}"`);
          if (p.risks.length > 0)     info(`  Sample risk: "${p.risks[0]}"`);
        } else {
          fail("PROCESS_CHUNK", "Response shape invalid");
        }
        runNext();
        return;
      }

      // SUMMARY_RESULT
      if (msg.type === "SUMMARY_RESULT") {
        clearTimeout(results["summary"]?.timeout);
        const p = msg.payload;
        if (p.summary && Array.isArray(p.tasks)) {
          ok("GENERATE_SUMMARY → valid summary received");
          info(`  Summary: "${p.summary?.slice(0, 100)}…"`);
          info(`  Tasks: ${p.tasks?.length}, Decisions: ${p.decisions?.length}, Risks: ${p.risks?.length}`);
        } else {
          fail("GENERATE_SUMMARY", "Response missing summary or tasks");
        }
        runNext();
        return;
      }

      // SUMMARY_ERROR (expected for empty transcript test)
      if (msg.type === "SUMMARY_ERROR") {
        clearTimeout(results["emptyGuard"]?.timeout);
        ok(`Empty transcript guard → SUMMARY_ERROR: "${msg.message}"`);
        runNext();
        return;
      }
    });

    ws.on("error", (e) => {
      fail("WebSocket", e.message);
      resolve();
    });

    ws.on("close", () => {
      printSummary();
      resolve();
    });

    let index = 0;
    function runNext() {
      if (index < testQueue.length) {
        testQueue[index++]();
      } else {
        // All done
        setTimeout(() => ws.close(), 500);
      }
    }
  });
}

function printSummary() {
  const total = passed + failed;
  console.log("\n" + "─".repeat(45));
  console.log(BO(`  Test Results: ${passed}/${total} passed`));
  if (failed === 0) {
    console.log(G(`  🎉 All tests passed! Backend is working correctly.`));
  } else {
    console.log(R(`  ⚠️  ${failed} test(s) failed. Check logs above.`));
  }
  console.log("─".repeat(45) + "\n");
}

// ── Main ──
(async () => {
  console.log(BO("\n════════════════════════════════════════════"));
  console.log(BO("  🧠 MeetSense AI — Backend Integration Tests"));
  console.log(BO("════════════════════════════════════════════"));

  await testHealth();
  console.log(BO("\n🔌 Test 2: WebSocket Connection"));
  await testWebSocket();
})();
