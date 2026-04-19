// ============================================================
// llmOrchestrator.js — Gemini 2.5 Flash API with Backoff
//
// Two exported functions:
//   callGeminiInsights(prompt) → real-time chunk extraction
//   callGeminiSummary(prompt)  → full meeting summary
//
// Both use exponential backoff on 429 rate-limit errors.
// ============================================================

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = "gemini-2.5-flash"; // recommended current model

// ── Shared: call Gemini with exponential backoff on 429 ──
async function callGeminiWithBackoff(prompt, maxRetries = 3) {
  let delay = 2000; // initial backoff: 2s

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json", // enforces JSON output
          temperature: 0.2,                     // low = less hallucination
          maxOutputTokens: 500,                 // cap output size
        }
      });

      const raw = response.text;
      return parseAndValidate(raw);

    } catch (err) {
      const is429 = err?.status === 429 ||
                    err?.message?.includes("429") ||
                    err?.message?.toLowerCase().includes("quota");

      if (is429 && attempt < maxRetries - 1) {
        console.warn(`[LLM] Rate limit hit (attempt ${attempt + 1}). Backing off ${delay}ms…`);
        await sleep(delay);
        delay = Math.min(delay * 2, 16000); // 2s → 4s → 8s → cap at 16s
        continue;
      }

      const isTimeout = err?.message?.includes("timeout") || err?.code === "ETIMEDOUT";
      if (isTimeout) {
        console.warn("[LLM] Timeout on Gemini call — skipping cycle.");
        return null;
      }

      console.error("[LLM] Gemini call failed:", err.message);
      return null; // UI retains last state
    }
  }

  return null;
}

// ── TRACK B: Real-time insights extraction ──
async function callGeminiInsights(prompt) {
  console.log("[LLM] Calling Gemini for insights…");
  const result = await callGeminiWithBackoff(prompt, maxRetries = 3);

  if (result) {
    console.log(`[LLM] Extracted: ${result.tasks?.length || 0} tasks, ${result.decisions?.length || 0} decisions.`);
  }

  return result;
}

// ── TRACK C: Full meeting summary (1 call per user request) ──
// More retries allowed since user manually triggered it
async function callGeminiSummary(prompt) {
  console.log("[LLM] Calling Gemini for full summary…");
  const result = await callGeminiWithBackoff(prompt, maxRetries = 4);

  if (result?.summary) {
    console.log("[LLM] Summary generated successfully.");
  }

  return result;
}

// ── JSON validator ──
function parseAndValidate(raw) {
  if (!raw) return null;

  try {
    // Strip markdown code fences if model wraps in ```json
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);

    // Ensure base shape exists
    if (typeof parsed !== "object" || parsed === null) return null;

    return {
      tasks:     Array.isArray(parsed.tasks)     ? parsed.tasks     : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      risks:     Array.isArray(parsed.risks)      ? parsed.risks     : [],
      summary:   typeof parsed.summary === "string" ? parsed.summary : undefined
    };

  } catch (e) {
    console.warn("[LLM] JSON parse failed:", e.message, "| Raw:", raw?.slice(0, 100));
    return null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { callGeminiInsights, callGeminiSummary };
