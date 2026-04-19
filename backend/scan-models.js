require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const models = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-preview-04-17",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b"
];

async function tryModel(m) {
  try {
    const r = await ai.models.generateContent({
      model: m,
      contents: "Say hello",
      config: { maxOutputTokens: 20 }
    });
    console.log(`✅  OK   : ${m}`);
    console.log(`         response: ${r.text?.slice(0, 60)}`);
  } catch (e) {
    let code = "?", msg = e.message?.slice(0, 100);
    try { const parsed = JSON.parse(e.message.match(/\{[\s\S]*\}/)?.[0] || "{}"); code = parsed?.error?.code; msg = parsed?.error?.message?.slice(0, 100); } catch {}
    console.log(`❌  FAIL : ${m} | code=${code} | ${msg}`);
  }
}

(async () => {
  console.log("=== Model Availability Scan ===\n");
  for (const m of models) {
    await tryModel(m);
    await new Promise(r => setTimeout(r, 1500)); // 1.5s between checks
  }
  console.log("\n=== Done ===");
})();
