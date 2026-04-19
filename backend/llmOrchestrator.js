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

// Model priority list — tries each in order until one works
const MODELS = [
  "gemini-3.1-flash-lite-preview", // ← Requested: blazing fast response
  "gemini-2.5-flash-lite",         // ← Fallback
  "gemini-2.5-flash"
];

async function callGeminiWithBackoff(prompt, maxRetries = 3) {
  let delay = 2000;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[LLM] Calling ${model} (attempt ${attempt + 1})...`);

        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            temperature:     0.2,
            maxOutputTokens: 600,
          }
        });

        let raw;
        if (typeof response.text === "string") {
          raw = response.text;
        } else if (typeof response.text === "function") {
          raw = response.text();
        } else if (response.response && typeof response.response.text === "function") {
          raw = response.response.text();
        } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
          raw = response.candidates[0].content.parts[0].text;
        } else {
          raw = String(response.text || "");
        }

        console.log(`[LLM] Raw response (first 200 chars): ${raw?.slice(0, 200)}`);

        const parsed = parseAndValidate(raw);
        if (parsed) {
          console.log(`[LLM] ✅ Parsed OK with model: ${model}`);
          return parsed;
        } else {
          console.warn(`[LLM] ⚠️ parseAndValidate returned null for model ${model}`);
        }

      } catch (err) {
        const is429 = err?.status === 429 ||
                      err?.message?.includes("429") ||
                      err?.message?.toLowerCase().includes("quota") ||
                      err?.message?.toLowerCase().includes("rate");

        console.error(`[LLM] ❌ ${model} attempt ${attempt + 1} failed: ${err.message?.slice(0, 200)}`);

        if (is429 && attempt < maxRetries - 1) {
          console.warn(`[LLM] Rate limit — backing off ${delay}ms...`);
          await sleep(delay);
          delay = Math.min(delay * 2, 16000);
          continue;
        }

        if (err?.message?.includes("timeout") || err?.code === "ETIMEDOUT") {
          console.warn("[LLM] Timeout — skipping this cycle.");
          return null;
        }

        break;
      }
    }
  }

  console.error("[LLM] All models exhausted — returning null.");
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
async function callGeminiSummary(prompt) {
  console.log(`[LLM/Summary] ► Starting summary generation.`);
  console.log(`[LLM/Summary]   Prompt length : ${prompt?.length ?? 0} chars`);

  let delay = 2000;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        console.log(`[LLM/Summary] Trying model: ${model} (attempt ${attempt + 1})...`);

        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        });

        let raw;
        if (typeof response.text === "string") {
          raw = response.text;
        } else if (typeof response.text === "function") {
          raw = response.text();
        } else if (response.response && typeof response.response.text === "function") {
          raw = response.response.text();
        } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
          raw = response.candidates[0].content.parts[0].text;
        } else {
          raw = String(response.text || "");
        }

        console.log(`[LLM/Summary] Raw response length: ${raw?.length ?? 0} chars`);
        console.log(`[LLM/Summary] Raw (first 300): ${raw?.slice(0, 300)}`);

        const parsed = parseAndValidate(raw, true);
        if (parsed) {
          console.log(`[LLM/Summary] ✅ Parsed successfully with ${model}`);
          return parsed;
        } else {
          console.error(`[LLM/Summary] ❌ parseAndValidate returned null for model: ${model}`);
        }

      } catch (err) {
        console.error(`[LLM/Summary] ❌ Model ${model} attempt ${attempt + 1} error: ${err.message?.slice(0, 200)}`);

        const is429 = err?.status === 429 ||
                      err?.message?.includes("429") ||
                      err?.message?.toLowerCase().includes("quota") ||
                      err?.message?.toLowerCase().includes("rate");

        if (is429 && attempt < 3) {
          console.warn(`[LLM/Summary] Rate limited. Backing off ${delay}ms...`);
          await sleep(delay);
          delay = Math.min(delay * 2, 16000);
          continue;
        }

        break;
      }
    }
  }

  console.error("[LLM/Summary] ❌ All models failed. Returning null to server.");
  return null;
}

// ── JSON validator ──
function parseAndValidate(raw, isSummary = false) {
  if (!raw || typeof raw !== "string") {
    console.warn("[LLM/Parse] Input is null/undefined/not a string.");
    return null;
  }

  try {
    let cleaned = raw.trim();

    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/im, "")
        .replace(/\n?```\s*$/m, "")
        .trim();
      console.log("[LLM/Parse] Stripped markdown fences from response.");
    }

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd   = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(cleaned);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("[LLM/Parse] ❌ Parsed value is not a plain object.");
      return null;
    }

    const missing = [];
    if (!Array.isArray(parsed.tasks))     missing.push("tasks");
    if (!Array.isArray(parsed.decisions)) missing.push("decisions");
    if (!Array.isArray(parsed.risks))     missing.push("risks");
    if (isSummary && typeof parsed.summary !== "string") missing.push("summary (string)");

    if (missing.length > 0) {
      console.warn(`[LLM/Parse] ⚠️ Missing fields: ${missing.join(", ")}. Found: ${Object.keys(parsed).join(", ")}`);
      if (!isSummary) {
        return {
          tasks:     Array.isArray(parsed.tasks)     ? parsed.tasks     : [],
          decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
          risks:     Array.isArray(parsed.risks)      ? parsed.risks     : [],
        };
      }
      return null;
    }

    return {
      tasks:     parsed.tasks,
      decisions: parsed.decisions,
      risks:     parsed.risks,
      summary:   typeof parsed.summary === "string" ? parsed.summary : undefined
    };

  } catch (e) {
    console.error(`[LLM/Parse] ❌ JSON.parse failed: ${e.message}`);
    console.error(`[LLM/Parse]   Raw (first 500): ${raw?.slice(0, 500)}`);
    return null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { callGeminiInsights, callGeminiSummary };
